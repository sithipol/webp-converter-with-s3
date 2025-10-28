# WebP Converter with S3

เครื่องมือ CLI สำหรับแปลงไฟล์รูปภาพใน AWS S3 bucket เป็นรูปแบบ WebP อย่างมีประสิทธิภาพ พร้อมระบบตรวจสอบสุขภาพและการจัดการข้อผิดพลาด

## ✨ คุณสมบัติหลัก

- 🚀 **แปลงแบบกลุ่ม**: แปลงรูปภาพทั้งหมดใน S3 bucket เป็น WebP
- 🏥 **ตรวจสอบสุขภาพ**: ระบบ health check แบบ CLI และ HTTP endpoint
- 🔄 **Resume ได้**: รองรับการกู้คืนงานหากเกิดข้อผิดพลาดระหว่างแปลง
- ⚙️ **ปรับแต่งคุณภาพ**: กำหนดคุณภาพ WebP และดูอัตราการบีบอัด
- ☁️ **AWS Integration**: เชื่อมต่อ S3 อย่างสมบูรณ์พร้อมระบบ retry
- 📊 **รายงานผล**: สรุปผลการแปลงพร้อมสถิติการประหยัดพื้นที่

## 🛠 เทคโนโลยี

- **Runtime**: Node.js + TypeScript
- **Image Processing**: Sharp (ประสิทธิภาพสูง)
- **AWS SDK**: @aws-sdk/client-s3
- **CLI Framework**: Commander.js
- **Logging**: Winston พร้อม log rotation
- **HTTP Server**: Express.js

## 📦 การติดตั้ง

### 1. Clone โปรเจค
```bash
git clone <repository-url>
cd webp-converter-with-s3
```

### 2. ติดตั้ง dependencies
```bash
npm install
```

### 3. สร้างไฟล์ .env
```bash
# AWS Configuration
AWS_REGION=ap-southeast-1
AWS_BUCKET=your-bucket-name
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_PREFIX=images/

# Conversion Settings
WEBP_QUALITY=80
SUPPORTED_FORMATS=jpeg,jpg,png
MAX_FILE_SIZE=104857600

# Processing Settings
CONCURRENCY=5
RETRY_ATTEMPTS=3
RETRY_DELAY=1000

# Server Settings
HOST=localhost
PORT=3000

# Logging
LOG_LEVEL=info
LOG_FORMAT=json
```

### 4. Build โปรเจค
```bash
npm run build
```

## 🚀 การใช้งาน

### CLI Commands

#### ตรวจสอบสุขภาพระบบ
```bash
npm run cli health
```
หรือ
```bash
npm run cli health --verbose
```

#### แปลงรูปภาพ
```bash
npm run cli convert
```

#### ตัวเลือกเพิ่มเติม
```bash
# ทดสอบโดยไม่แปลงจริง
npm run cli convert --dry-run

# แสดงข้อมูลละเอียด
npm run cli convert --verbose

# ข้ามการตรวจสอบเริ่มต้น
npm run cli convert --skip-validation
```

### HTTP Server Mode
```bash
npm start
```

เข้าถึง health check endpoint ที่: `http://localhost:3000/health`

## 📁 โครงสร้างโปรเจค

```
src/
├── cli.ts              # CLI entry point
├── index.ts            # Application class หลัก
├── config/
│   └── index.ts        # การจัดการ configuration
├── models/
│   └── image.ts        # Interface และ type definitions
├── services/
│   ├── convertionService.ts    # บริการแปลงแบบกลุ่ม
│   ├── expressService.ts       # HTTP server
│   ├── imageProcess.ts         # การประมวลผลรูปภาพ
│   └── s3Service.ts            # การเชื่อมต่อ S3
└── utils/
    ├── error.ts        # Custom error classes
    └── logger.ts       # การตั้งค่า logging
```

## ⚙️ การตั้งค่า

### รูปแบบที่รองรับ
- JPEG (.jpeg, .jpg)
- PNG (.png)

### ข้อกำหนดระบบ
- Node.js 18+ 
- npm 8+
- AWS credentials ที่มีสิทธิ์เข้าถึง S3

### AWS Permissions ที่จำเป็น
```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "s3:GetObject",
                "s3:PutObject",
                "s3:ListBucket"
            ],
            "Resource": [
                "arn:aws:s3:::your-bucket-name",
                "arn:aws:s3:::your-bucket-name/*"
            ]
        }
    ]
}
```

## 📊 ตัวอย่างผลลัพธ์

```
🚀 Starting S3 Image WebP Converter...

✅ Configuration loaded successfully
📁 Target bucket: my-images-bucket
🌍 AWS region: ap-southeast-1
🎨 WebP quality: 80
⚡ Concurrency: 5

🔍 Processing images...
✅ Converted: image1.jpg → image1.webp (45% smaller)
✅ Converted: image2.png → image2.webp (62% smaller)
⚠️  Skipped: image3.webp (already WebP)

📈 Conversion Report:
- Total images: 150
- Successful: 147
- Failed: 0
- Skipped: 3
- Space saved: 2.3 GB → 1.1 GB (52% reduction)
- Processing time: 5m 23s

✅ Image conversion process completed successfully
```

## 🔧 Development

### การพัฒนา
```bash
npm run dev          # เริ่ม development server
```

### การ build
```bash
npm run build        # compile TypeScript
```

### การทดสอบ
```bash
npm test            # รัน tests (ยังไม่ได้ implement)
```

## 📝 Logs

Logs จะถูกเก็บไว้ในโฟลเดอร์ `logs/` พร้อมการ rotate รายวัน:
- `logs/YYYY-MM-DD.log` - Log ประจำวัน
- Log เก่าจะถูกบีบอัดและเก็บไว้ 14 วัน

## 🤝 การมีส่วนร่วม

1. Fork โปรเจค
2. สร้าง feature branch (`git checkout -b feature/amazing-feature`)
3. Commit การเปลี่ยนแปลง (`git commit -m 'Add amazing feature'`)
4. Push ไปยัง branch (`git push origin feature/amazing-feature`)
5. เปิด Pull Request

## 📄 License

โปรเจคนี้ใช้ ISC License

## 🆘 การแก้ไขปัญหา

### ปัญหาที่พบบ่อย

**Q: ได้รับ error "Configuration validation failed"**
A: ตรวจสอบไฟล์ .env และให้แน่ใจว่าค่าทั้งหมดถูกต้อง รัน `npm run cli health` เพื่อดูรายละเอียด

**Q: การแปลงช้า**
A: เพิ่มค่า `CONCURRENCY` ในไฟล์ .env (แนะนำ 3-10 ขึ้นอยู่กับ instance)

**Q: หน่วยความจำเต็ม**
A: ลดค่า `CONCURRENCY` หรือ `MAX_FILE_SIZE` ในไฟล์ .env

**Q: AWS credentials error**
A: ตรวจสอบ AWS credentials และ permissions ด้วย `aws s3 ls s3://your-bucket-name`