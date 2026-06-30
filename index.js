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

// --- GLOBAL LOGGER ---
app.use((req, res, next) => {
    console.log(`[SYSTEM LOG] ${req.method} request incoming to path: ${req.path}`);
    next();
});

app.get('*', (req, res) => {
    res.status(200).send("Universal Media Factory & R2 Vault is Online");
});

// Helper function to wrap FFmpeg processing in a Promise for sequential batching
const processMedia = (inputPath, logoPath, fontPath, sanitizedHeadline, mediaType, internalTargetOut) => {
    return new Promise((resolve, reject) => {
        let ffCommand = ffmpeg().input(inputPath).input(logoPath);
        let filterComplexString = "";
        const isStaticImage = mediaType.includes('image');

        if (mediaType === 'video-16-9') {
            filterComplexString = [
                "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=18[bg];" +
                "[0:v]scale=1080:-1[main];" +
                "[bg][main]overlay=(W-w)/2:(H-h)/2[base];" +
                `[base]drawtext=fontfile='${fontPath}':text='${sanitizedHeadline}':fontsize=32:fontcolor=black:x=60:y=h-500:box=1:boxcolor=white@1.0:boxborderw=14:bordercolor=black:borderw=1[vtext];` +
                "[1:v]scale=220:-1[logo];" +
                "[vtext][logo]overlay=800:400[vout]"
            ];
        } else if (isStaticImage) {
            filterComplexString = [
                "scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080,format=rgba,vignette=PI/6[base];" +
                `[base]drawtext=fontfile='${fontPath}':text='${sanitizedHeadline}':fontsize=42:fontcolor=white:x=50:y=h-200:shadowcolor=black:shadowx=2.5:shadowy=3[txt];` +
                "[1:v]scale=200:-1[logo];" +
                "[txt][logo]overlay=W-w-20:H-h-20[vout]"
            ];
        } else {
            filterComplexString = [
                "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[base];" +
                `[base]drawtext=fontfile='${fontPath}':text='${sanitizedHeadline}':fontsize=32:fontcolor=black:x=60:y=h-400:box=1:boxcolor=white@1.0:boxborderw=14:bordercolor=black:borderw=1[vtext];` +
                "[1:v]scale=220:-1[logo];" +
                "[vtext][logo]overlay=W-w-60:60[vout]"
            ];
        }

        ffCommand.complexFilter(filterComplexString).outputOptions(['-map [vout]']);

        if (isStaticImage) {
            ffCommand.outputOptions(['-vframes 1']);
        } else {
            ffCommand.outputOptions([
                '-threads 2', '-bufsize 2000k', '-max_muxing_queue_size 999',  
                '-c:v libx264', '-preset ultrafast', '-crf 23', '-c:a aac', '-b:a 128k', '-movflags +faststart', '-map 0:a?'
            ]);
        }

        ffCommand.output(internalTargetOut)
            .on('end', () => resolve(internalTargetOut))
            .on('error', (err) => reject(err))
            .run();
    });
};

// MAIN BATCH PRODUCTION ENTRY ROUTE
app.post('*', upload.array('mediaFiles', 12), async (req, res) => {
    console.log("[MEDIA INGESTION] Raw media buffer array delivered to processing gateway.");
    
    const headline = req.header('x-headline') || 'Breaking News';
    const channelName = req.header('x-channel-name') || 'Telangana First';
    const mediaType = req.header('x-media-type') || 'video-9-16'; 

    const files = req.files;
    if (!files || files.length === 0) {
        return res.status(400).send({ error: "Missing uploaded binary asset data." });
    }

    const logoPath = path.join(__dirname, 'logos', `${channelName} Logo.png`);
    const fontPath = path.join(__dirname, 'Poppins-Bold.ttf');

    if (!fs.existsSync(logoPath) || !fs.existsSync(fontPath)) {
        files.forEach(f => { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); });
        return res.status(404).send({ error: `Missing structural assets (Logo/Font). Rebuild container.` });
    }

    const sanitizedHeadline = headline
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "'\\''")
        .replace(/:/g, '\\:')
        .replace(/,/g, '\\,')
        .replace(/%/g, '\\%');

    const isStaticImage = mediaType.includes('image');
    const safeChannelName = channelName.replace(/\s+/g, '-').toLowerCase();
    const uploadedR2Urls = [];

    try {
        // Process files sequentially to prevent container memory overload
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const internalTargetOut = `/tmp/render_${Date.now()}_${i}${isStaticImage ? '.png' : '.mp4'}`;
            const r2FileName = `${safeChannelName}-latest${files.length > 1 ? '-' + i : ''}${isStaticImage ? '.png' : '.mp4'}`;

            console.log(`[ENGINE] Processing file ${i + 1}/${files.length} for ${channelName}...`);
            await processMedia(file.path, logoPath, fontPath, sanitizedHeadline, mediaType, internalTargetOut);

            console.log(`[R2 VAULT] Pushing ${r2FileName} to Cloudflare...`);
            const fileStream = fs.createReadStream(internalTargetOut);
            await s3Client.send(new PutObjectCommand({
                Bucket: process.env.R2_BUCKET_NAME,
                Key: r2FileName,
                Body: fileStream,
                ContentType: isStaticImage ? 'image/png' : 'video/mp4'
            }));

            // Clean up temporary internal files after successful push
            if (fs.existsSync(internalTargetOut)) fs.unlinkSync(internalTargetOut);
            if (fs.existsSync(file.path)) fs.unlinkSync(file.path);

            uploadedR2Urls.push(`${process.env.R2_PUBLIC_URL}/${r2FileName}`);
        }

        res.status(200).send({ 
            status: 'success', 
            message: `Render and R2 Vault override successful`, 
            r2Urls: uploadedR2Urls // Returns an array of clean public links
        });

    } catch (globalError) {
        console.error(`[CRITICAL ERROR]:`, globalError);
        files.forEach(f => { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); });
        return res.status(500).send({ error: "Pipeline fault: " + globalError.message });
    }
});

const PORT = 7860;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Universal Media Engine & R2 Vault listening on port ${PORT}`);
});
