const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const app = express();
const upload = multer({ dest: '/tmp/' }); 

app.use(express.json());

// --- CLOUDFLARE R2 CLIENT INITIALIZATION ---
const s3Client = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY,
        secretAccessKey: process.env.R2_SECRET_KEY,
    }
});

app.use((req, res, next) => {
    console.log(`[SYSTEM LOG] ${req.method} request incoming to path: ${req.path}`);
    next();
});

app.get('*', (req, res) => {
    res.status(200).send("Universal Media Factory & Native R2 Vault is Online");
});

// --- TEXT WRAPPING HELPER (Replicates your Bash AWK script) ---
function formatCaption(text, limit) {
    let cleanText = text.toUpperCase().replace(/'/g, '’').replace(/\n/g, ' ').trim();
    if (!cleanText) return ["NO HEADLINE PROVIDED"];

    const words = cleanText.split(' ');
    let lines = [];
    let currentLine = "";

    words.forEach(word => {
        if ((currentLine + word).length > limit) {
            if (currentLine) lines.push(currentLine.trim());
            currentLine = word + " ";
        } else {
            currentLine += word + " ";
        }
    });
    if (currentLine) lines.push(currentLine.trim());
    return lines;
}

// Helper to execute FFmpeg synchronously for batch processing
const processMedia = (inputPath, logoPath, gradientPath, fontPath, headline, mediaType, is16by9, targetOut) => {
    return new Promise((resolve, reject) => {
        let ffCommand = ffmpeg().input(inputPath).input(logoPath);
        
        let filterComplex = "";
        const isPhoto = mediaType === 'photo';

        if (isPhoto) {
            // IMAGE EDITING LOGIC (Exactly matching your Image Bash Script)
            ffCommand.input(gradientPath);
            const wrappedLines = formatCaption(headline, 32).join('\\n');
            
            filterComplex = [
                "[0:v]scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080,format=rgba,vignette=PI/6[base];",
                "[2:v]scale=1080:480[grad_img];",
                "[base][grad_img]overlay=0:610[bg];",
                `[bg]drawtext=fontfile='${fontPath}':text='${wrappedLines}':fontsize=42:fontcolor=white@0.9:line_spacing=18:x=50:y=h-200:box=0:shadowcolor=black:shadowx=2.5:shadowy=3[txt];`,
                "[1:v]scale=200:-1[logo];",
                "[txt][logo]overlay=W-w-20:H-h-20[vout]"
            ].join('');

            ffCommand.outputOptions(['-vframes 1']);
        } else {
            // VIDEO EDITING LOGIC (Matching your 9:16 and 16:9 Bash Scripts)
            const wrappedLinesArray = formatCaption(headline, 42); // 42 chars for video
            const fontSize = 32;
            const lineSpacing = 25;
            const bottomPadding = is16by9 ? 500 : 400;
            const lineHeight = fontSize + lineSpacing;
            const totalTextHeight = wrappedLinesArray.length * lineHeight;

            let baseSetup = "";
            if (is16by9) {
                // 16:9 Letterbox Blur Logic
                baseSetup = "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=18[bg];" +
                            "[0:v]scale=1080:-1[main];" +
                            "[bg][main]overlay=(W-w)/2:(H-h)/2[base];";
            } else {
                // 9:16 Standard Logic
                baseSetup = "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[base];";
            }

            // Dynamic Multi-Line Drawtext with exact box borders
            let textFilters = "";
            let prevLabel = "base";
            
            wrappedLinesArray.forEach((line, i) => {
                const yOffset = i * lineHeight;
                const nextLabel = `txt${i}`;
                // Calculate precise Y position mimicking your bash logic
                const escapedLine = line.replace(/:/g, '\\:').replace(/,/g, '\\,');
                textFilters += `[${prevLabel}]drawtext=fontfile='${fontPath}':text='${escapedLine}':fontsize=${fontSize}:fontcolor=black@1.0:x=60:y=h-${bottomPadding}-${totalTextHeight}+${yOffset}:box=1:boxcolor=white@1.0:boxborderw=14:bordercolor=black:borderw=0.6[${nextLabel}];`;
                prevLabel = nextLabel;
            });

            const logoOverlayPos = is16by9 ? "800:400" : "W-w-60:60";
            filterComplex = baseSetup + textFilters + `[1:v]scale=220:-1[logo];[${prevLabel}][logo]overlay=${logoOverlayPos}[vout]`;

            ffCommand.outputOptions([
                '-threads 2', '-c:v libx264', '-preset veryfast', '-crf 23', 
                '-c:a aac', '-b:a 128k', '-movflags +faststart', '-map 0:a?'
            ]);
        }

        ffCommand.complexFilter(filterComplex).outputOptions(['-map [vout]']);

        ffCommand.output(targetOut)
            .on('end', () => resolve(targetOut))
            .on('error', (err) => reject(err))
            .run();
    });
};

// MAIN BATCH PRODUCTION ENTRY ROUTE
app.post('*', upload.array('mediaFiles', 10), async (req, res) => {
    
    const headline = req.header('x-headline') || 'Breaking News';
    const channelName = req.header('x-channel-name') || 'Telangana First';
    const mediaType = req.header('x-media-type') || 'video'; // 'photo' or 'video'
    const is16by9 = req.header('x-is-landscape') === 'true';

    const files = req.files;
    if (!files || files.length === 0) return res.status(400).send({ error: "Missing binary data." });

    const logoPath = path.join(__dirname, 'logos', `${channelName} Logo.png`);
    const fontPath = path.join(__dirname, 'Poppins-Bold.ttf');
    const gradientPath = path.join(__dirname, 'logos', 'Graident.png'); // Sourced exactly per your image script

    if (!fs.existsSync(logoPath) || !fs.existsSync(fontPath)) {
        files.forEach(f => { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); });
        return res.status(404).send({ error: `Missing Logo or Font. Factory Rebuild required.` });
    }

    const isPhoto = mediaType === 'photo';
    const safeChannelName = channelName.replace(/\s+/g, '-').toLowerCase();
    const uploadedR2Urls = [];

    try {
        // Sequential Array Processing (Prevents memory spikes, supports Carousels cleanly)
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const internalTargetOut = `/tmp/render_${Date.now()}_${i}${isPhoto ? '.png' : '.mp4'}`;
            const r2FileName = `${safeChannelName}-latest${files.length > 1 ? '-' + i : ''}${isPhoto ? '.png' : '.mp4'}`;

            console.log(`[ENGINE] Processing file ${i + 1}/${files.length} for ${channelName}...`);
            await processMedia(file.path, logoPath, gradientPath, fontPath, headline, mediaType, is16by9, internalTargetOut);

            console.log(`[R2 VAULT] Pushing ${r2FileName} to Cloudflare...`);
            const fileStream = fs.createReadStream(internalTargetOut);
            await s3Client.send(new PutObjectCommand({
                Bucket: process.env.R2_BUCKET_NAME,
                Key: r2FileName,
                Body: fileStream,
                ContentType: isPhoto ? 'image/png' : 'video/mp4'
            }));

            if (fs.existsSync(internalTargetOut)) fs.unlinkSync(internalTargetOut);
            if (fs.existsSync(file.path)) fs.unlinkSync(file.path);

            uploadedR2Urls.push(`${process.env.R2_PUBLIC_URL}/${r2FileName}`);
        }

        res.status(200).send({ status: 'success', r2Urls: uploadedR2Urls });

    } catch (err) {
        console.error(`[CRITICAL ERROR]:`, err);
        files.forEach(f => { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); });
        return res.status(500).send({ error: "Pipeline fault: " + err.message });
    }
});

const PORT = 7860;
app.listen(PORT, '0.0.0.0', () => console.log(`Universal Media Engine listening on port ${PORT}`));
