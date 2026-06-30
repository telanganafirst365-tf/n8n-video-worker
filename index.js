const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();

// Configure multer to handle up to 12 files concurrently for carousel compilation arrays
const upload = multer({ dest: '/tmp/' }); 

app.use(express.json());

// --- GLOBAL LOGGER ---
app.use((req, res, next) => {
    console.log(`[SYSTEM LOG] ${req.method} request incoming to path: ${req.path}`);
    next();
});

// GET request handler for simple browser health checks
app.get('*', (req, res) => {
    res.status(200).send("Universal Multi-Brand Media Factory Engine is Online and Active");
});

// MAIN DEVELOPMENT & BATCH PRODUCTION ENTRY ROUTE
app.post('*', upload.array('mediaFiles', 12), async (req, res) => {
    console.log("[MEDIA INGESTION] Raw media buffer array delivered to processing gateway.");
    
    // Extract metadata strings from headers passed by n8n
    const headline = req.header('x-headline') || 'Breaking News';
    const channelName = req.header('x-channel-name') || 'Telangana First';
    const outputPath = req.header('x-output-path') || `/tmp/output-${Date.now()}.mp4`;
    
    // Core structural control keys for format selection
    // Supported Types: 'video-9-16' (Shorts), 'video-16-9' (Standard), 'image-static' (Single Post), 'carousel-video' (Image Loop)
    const mediaType = req.header('x-media-type') || 'video-9-16'; 
    const previewMode = req.header('x-preview-mode') || 'false';  // If true, stream binary back directly

    const files = req.files;
    if (!files || files.length === 0) {
        console.error("[ERROR] No input media files received in multipart body.");
        return res.status(400).send({ error: "Missing uploaded binary asset data." });
    }

    const logoPath = path.join(__dirname, 'logos', `${channelName} Logo.png`);
    const fontPath = path.join(__dirname, 'Poppins-Bold.ttf');

    // --- PRE-FLIGHT ASSET SECURITY CHECKS ---
    if (!fs.existsSync(logoPath)) {
        let availableFiles = "Directory 'logos' does not exist.";
        const logosDir = path.join(__dirname, 'logos');
        if (fs.existsSync(logosDir)) {
            availableFiles = fs.readdirSync(logosDir).join(', ');
        }
        // Cleanup parsed inputs on validation failure
        files.forEach(f => { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); });
        return res.status(404).send({ error: `Missing Logo: ${logoPath}. Existing files: [${availableFiles}]` });
    }

    if (!fs.existsSync(fontPath)) {
        files.forEach(f => { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); });
        return res.status(404).send({ error: `Missing Font File: ${fontPath}` });
    }

    // --- FILTER STRING ESCAPE SANITIZATION ---
    const sanitizedHeadline = headline
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "'\\''")
        .replace(/:/g, '\\:')
        .replace(/,/g, '\\,')
        .replace(/%/g, '\\%');

    console.log(`[ENGINE FLOW INITIALIZED] Mode: ${mediaType} | Channel: ${channelName} | Files Received: ${files.length}`);

    // Track output extension parameters cleanly
    const isStaticImage = mediaType === 'image-static';
    const internalTargetOut = (previewMode === 'true') 
        ? `/tmp/preview_render_${Date.now()}` + (isStaticImage ? '.png' : '.mp4') 
        : outputPath;

    // Ensure output directories are clean
    mkdirParent(path.dirname(internalTargetOut));

    try {
        let ffCommand = ffmpeg();

        if (mediaType === 'carousel-video') {
            // --- CAROUSEL ASSEMBLY ENGINE CONFIGURATION ---
            // Compiles an array of static images into a fluid slideshow with transitions
            files.forEach(f => { ffCommand.input(f.path).loop(3); }); // Loop each image for 3 seconds
            ffCommand.input(logoPath);

            let filterComplexString = "";
            let scaleLabels = [];
            
            // Step 1: Normalize all incoming carousel images to standard vertical video formats
            for (let i = 0; i < files.length; i++) {
                filterComplexString += `[${i}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,format=rgba[img${i}];`;
                scaleLabels.push(`[img${i}]`);
            }

            // Step 2: Concat individual loops together
            filterComplexString += `${scaleLabels.join('')}concat=n=${files.length}:v=1:a=0[slideshow];`;
            
            // Step 3: Layer Headline text and Branding logo assets onto composite stream
            filterComplexString += `[slideshow]drawtext=fontfile='${fontPath}':text='${sanitizedHeadline}':fontsize=32:fontcolor=white:x=60:y=1000[vtext];`;
            filterComplexString += `[${files.length}:v]scale=220:-1[logo];[vtext][logo]overlay=W-w-60:60[vout]`;

            ffCommand.complexFilter(filterComplexString).outputOptions(['-map [vout]']);

        } else {
            // --- SINGLE FILE PASS RE-SIZING ENGINES ---
            ffCommand.input(files[0].path).input(logoPath);

            let filterComplexString = "";

            if (mediaType === 'video-16-9') {
                // Horizontal Layout Landscape Filter Configuration ($16:9$)
                // Scales with soft background blur side-padding to fill original aspect ratio gaps cleanly
                filterComplexString = [
                    "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=18[bg];" +
                    "[0:v]scale=1080:-1[main];" +
                    "[bg][main]overlay=(W-w)/2:(H-h)/2[base];" +
                    `[base]drawtext=fontfile='${fontPath}':text='${sanitizedHeadline}':fontsize=32:fontcolor=black:x=60:y=h-500:box=1:boxcolor=white@1.0:boxborderw=14:bordercolor=black:borderw=1[vtext];` +
                    "[1:v]scale=220:-1[logo];" +
                    "[vtext][logo]overlay=800:400[vout]"
                ];
            } else if (mediaType === 'image-static') {
                // Single Static Image Square Profile Output Post Layout ($1:1$)
                filterComplexString = [
                    "scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080,format=rgba,vignette=PI/6[base];" +
                    `[base]drawtext=fontfile='${fontPath}':text='${sanitizedHeadline}':fontsize=42:fontcolor=white:x=50:y=h-200:shadowcolor=black:shadowx=2.5:shadowy=3[txt];` +
                    "[1:v]scale=200:-1[logo];" +
                    "[txt][logo]overlay=W-w-20:H-h-20[vout]"
                ];
            } else {
                // Standard Vertical Shorts Layout Filter Configuration ($9:16$)
                filterComplexString = [
                    "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[base];" +
                    `[base]drawtext=fontfile='${fontPath}':text='${sanitizedHeadline}':fontsize=32:fontcolor=black:x=60:y=h-400:box=1:boxcolor=white@1.0:boxborderw=14:bordercolor=black:borderw=1[vtext];` +
                    "[1:v]scale=220:-1[logo];" +
                    "[vtext][logo]overlay=W-w-60:60[vout]"
                ];
            }

            ffCommand.complexFilter(filterComplexString).outputOptions(['-map [vout]']);
        }

        // Apply global format-specific optimization options
        if (isStaticImage) {
            ffCommand.outputOptions(['-vframes 1']);
        } else {
            ffCommand.outputOptions([
                '-threads 2',                  
                '-bufsize 2000k',              
                '-max_muxing_queue_size 999',  
                '-c:v libx264', 
                '-preset ultrafast',           
                '-crf 23',                     
                '-c:a aac', 
                '-b:a 128k', 
                '-movflags +faststart'
            ]);
            // Re-mux audio tracks if available globally in container pipeline
            ffCommand.outputOptions(['-map 0:a?']);
        }

        ffCommand.output(internalTargetOut)
            .on('end', () => {
                console.log(`[ENGINE RENDER SUCCESS] Output compiled cleanly at: ${internalTargetOut}`);
                
                // Cleanup temp received parts immediately
                files.forEach(f => { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); });

                if (previewMode === 'true') {
                    res.status(200).sendFile(internalTargetOut, () => {
                        if (fs.existsSync(internalTargetOut)) fs.unlinkSync(internalTargetOut);
                        console.log("[PREVIEW STREAM] Dispatched raw rendered binary stream back to n8n workspace panel.");
                    });
                } else {
                    res.status(200).send({ status: 'success', message: `Render finished for ${channelName}`, targetFile: internalTargetOut });
                }
            })
            .on('error', (err) => {
                console.error(`[ENGINE CRASH] Critical error processing complex filters:`, err.message);
                files.forEach(f => { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); });
                if (fs.existsSync(internalTargetOut)) fs.unlinkSync(internalTargetOut);
                res.status(500).send({ error: "FFmpeg pipeline execution fault: " + err.message });
            })
            .run();

    } catch (globalError) {
        console.error("[GLOBAL GATEWAY CRITICAL ERROR]:", globalError.message);
        files.forEach(f => { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); });
        return res.status(500).send({ error: "Global catch fault: " + globalError.message });
    }
});

// Safe sync mapping helper tracking directory bounds recursively
function mkdirParent(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

const PORT = 7860;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Universal Media Engine Server listening actively on port ${PORT}`);
});
