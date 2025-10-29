import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger';

export interface ConversionRecord {
    sourceKey: string;
    targetKey: string;
    convertedAt: string;
    originalSize: number;
    convertedSize: number;
    compressionRatio: number;
}

export interface ConversionTracker {
    isConverted(sourceKey: string): Promise<boolean>;
    markAsConverted(record: ConversionRecord): Promise<void>;
    getConvertedKeys(): Promise<Set<string>>;
    loadConvertedKeys(): Promise<void>;
    flush(): Promise<void>;
}

export class FileBasedConversionTracker implements ConversionTracker {
    private readonly trackingFilePath: string;
    private readonly appendLogPath: string;
    private convertedKeys: Set<string> = new Set();
    private isLoaded: boolean = false;
    private writeQueue: ConversionRecord[] = [];
    private isWriting: boolean = false;

    constructor(trackingFilePath: string = 'logs/converted-images.json') {
        this.trackingFilePath = trackingFilePath;
        this.appendLogPath = trackingFilePath.replace('.json', '-append.log');
    }

    async loadConvertedKeys(): Promise<void> {
        if (this.isLoaded) return;

        try {
            // Ensure logs directory exists
            const logsDir = path.dirname(this.trackingFilePath);
            await fs.mkdir(logsDir, { recursive: true });

            // Load from main tracking file
            await this.loadFromMainFile();
            
            // Load from append log (for crash recovery)
            await this.loadFromAppendLog();

            logger.info(`Loaded ${this.convertedKeys.size} previously converted images from tracking files`, {
                operation: 'tracker.load',
                trackingFile: this.trackingFilePath,
                appendLogPath: this.appendLogPath,
                convertedCount: this.convertedKeys.size
            });
        } catch (error) {
            logger.warn('Failed to load conversion tracking files, starting fresh', {
                operation: 'tracker.loadError',
                error: error instanceof Error ? error.message : String(error),
                trackingFile: this.trackingFilePath
            });
            this.convertedKeys = new Set();
        }

        this.isLoaded = true;
    }

    private async loadFromMainFile(): Promise<void> {
        try {
            const data = await fs.readFile(this.trackingFilePath, 'utf-8');
            const records: ConversionRecord[] = JSON.parse(data);
            records.forEach(record => this.convertedKeys.add(record.sourceKey));
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                logger.warn('Error reading main tracking file', { error });
            }
        }
    }

    private async loadFromAppendLog(): Promise<void> {
        try {
            const data = await fs.readFile(this.appendLogPath, 'utf-8');
            const lines = data.trim().split('\n').filter(line => line.trim());
            
            for (const line of lines) {
                try {
                    const record: ConversionRecord = JSON.parse(line);
                    this.convertedKeys.add(record.sourceKey);
                } catch (parseError) {
                    logger.warn('Invalid JSON line in append log', { line, error: parseError });
                }
            }

            // If we loaded from append log, consolidate the files
            if (lines.length > 0) {
                await this.consolidateFiles();
            }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                logger.warn('Error reading append log file', { error });
            }
        }
    }

    async isConverted(sourceKey: string): Promise<boolean> {
        await this.loadConvertedKeys();
        return this.convertedKeys.has(sourceKey);
    }

    async markAsConverted(record: ConversionRecord): Promise<void> {
        await this.loadConvertedKeys();

        // Add to in-memory set
        this.convertedKeys.add(record.sourceKey);

        // Add to write queue for batch processing
        this.writeQueue.push(record);

        // Append to log file immediately (for crash recovery)
        await this.appendToLog(record);

        // Process write queue if not already processing
        if (!this.isWriting && this.writeQueue.length >= 100) {
            this.processWriteQueue();
        }

        // Log the conversion
        logger.info(`Image converted and tracked: ${record.sourceKey} -> ${record.targetKey}`, {
            operation: 'conversion.tracked',
            sourceKey: record.sourceKey,
            targetKey: record.targetKey,
            originalSize: record.originalSize,
            convertedSize: record.convertedSize,
            compressionRatio: record.compressionRatio,
            sizeSavedBytes: record.originalSize - record.convertedSize,
            convertedAt: record.convertedAt
        });
    }

    async getConvertedKeys(): Promise<Set<string>> {
        await this.loadConvertedKeys();
        return new Set(this.convertedKeys);
    }

    private async appendToLog(record: ConversionRecord): Promise<void> {
        try {
            const logLine = JSON.stringify(record) + '\n';
            await fs.appendFile(this.appendLogPath, logLine, 'utf-8');
        } catch (error) {
            logger.error('Failed to append to log file', {
                operation: 'tracker.appendError',
                error: error instanceof Error ? error.message : String(error),
                appendLogPath: this.appendLogPath,
                sourceKey: record.sourceKey
            });
            throw error;
        }
    }

    private async processWriteQueue(): Promise<void> {
        if (this.isWriting || this.writeQueue.length === 0) return;

        this.isWriting = true;
        const recordsToProcess = [...this.writeQueue];
        this.writeQueue = [];

        try {
            // Read existing records
            let existingRecords: ConversionRecord[] = [];
            try {
                const data = await fs.readFile(this.trackingFilePath, 'utf-8');
                existingRecords = JSON.parse(data);
            } catch (error) {
                // File doesn't exist, start fresh
                existingRecords = [];
            }

            // Add new records
            existingRecords.push(...recordsToProcess);

            // Write back to file
            await fs.writeFile(
                this.trackingFilePath,
                JSON.stringify(existingRecords, null, 2),
                'utf-8'
            );

            logger.info(`Batch updated tracking file with ${recordsToProcess.length} records`, {
                operation: 'tracker.batchWrite',
                recordCount: recordsToProcess.length,
                totalRecords: existingRecords.length
            });
        } catch (error) {
            // Put records back in queue for retry
            this.writeQueue.unshift(...recordsToProcess);
            
            logger.error('Failed to batch update tracking file', {
                operation: 'tracker.batchWriteError',
                error: error instanceof Error ? error.message : String(error),
                recordCount: recordsToProcess.length
            });
        } finally {
            this.isWriting = false;
        }
    }

    private async consolidateFiles(): Promise<void> {
        try {
            // Read all records from both files
            const allRecords: ConversionRecord[] = [];
            const seenKeys = new Set<string>();

            // Load from main file
            try {
                const mainData = await fs.readFile(this.trackingFilePath, 'utf-8');
                const mainRecords: ConversionRecord[] = JSON.parse(mainData);
                mainRecords.forEach(record => {
                    if (!seenKeys.has(record.sourceKey)) {
                        allRecords.push(record);
                        seenKeys.add(record.sourceKey);
                    }
                });
            } catch (error) {
                // Main file doesn't exist
            }

            // Load from append log
            const appendData = await fs.readFile(this.appendLogPath, 'utf-8');
            const lines = appendData.trim().split('\n').filter(line => line.trim());
            
            for (const line of lines) {
                try {
                    const record: ConversionRecord = JSON.parse(line);
                    if (!seenKeys.has(record.sourceKey)) {
                        allRecords.push(record);
                        seenKeys.add(record.sourceKey);
                    }
                } catch (parseError) {
                    logger.warn('Invalid JSON line during consolidation', { line });
                }
            }

            // Write consolidated file
            await fs.writeFile(
                this.trackingFilePath,
                JSON.stringify(allRecords, null, 2),
                'utf-8'
            );

            // Clear append log
            await fs.writeFile(this.appendLogPath, '', 'utf-8');

            logger.info(`Consolidated tracking files: ${allRecords.length} unique records`, {
                operation: 'tracker.consolidate',
                totalRecords: allRecords.length
            });
        } catch (error) {
            logger.error('Failed to consolidate tracking files', {
                operation: 'tracker.consolidateError',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    // Call this method when shutting down to flush remaining records
    async flush(): Promise<void> {
        if (this.writeQueue.length > 0) {
            await this.processWriteQueue();
        }
    }
}