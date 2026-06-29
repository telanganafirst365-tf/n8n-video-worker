const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const upload = multer({ dest: '/tmp/' }); 

app.use(express.json());

// --- GLOBAL LOGGER ---
app.use((req, res, next) => {
    console.log(`[SYSTEM LOG] ${req.method} request incoming to path: ${req.path}`);
    next();
});

// GET request handler for simple browser health checks
app.get('*', (req, res) => {
    res.status(200).send("Sequential Video Factory is Online and Active");
});

// BATCH BINARY ENTRY ROUTE
app.post('*', upload.single('videoFile'), async (req, res) => {
    console.log("[BINARY INGESTION] Raw media buffer delivered from n8n.");
    
    const headline = req.header('x-headline');
    const channelName = req.header('x-channel-name');
    const outputPath = req.header('x-output-path');

    if (!req.file) {
        console.error("[ERROR] No binary video file received.");
        return res.status(400).send({ error: "Missing uploaded binary file data." });
    }

    if (!headline || !channelName || !outputPath) {
        console.error("[ERROR] Missing rendering configuration values.");
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(400).send({ error: "Missing required header metrics (x-headline, x-channel-name, x-output-path)." });
    }

    const localInput = req.file.path; 
    
    // Dynamic Absolute Pathing
    const logoPath = path.join(__dirname, 'logos', `${channelName} Logo.png`);
    const fontPath = path.join(__dirname, 'Poppins-Bold.ttf');

    // --- X-RAY PRE-FLIGHT ASSET CHECKS ---
    if (!fs.existsSync(logoPath)) {
        let availableFiles = "Directory 'logos' does not exist in the container.";
        const logosDir = path.join(__dirname, 'logos');
        
        // Scan the directory to see what HF actually downloaded
        if (fs.existsSync(logosDir)) {
            availableFiles = fs.readdirSync(logosDir).join(', ');
        }
        
        console.error(`[CRITICAL ASSET MISSING] Could not find logo at: ${logoPath}`);
        console.error(`[DEBUG X-RAY] Files actually inside /logos/: [${availableFiles}]`);
        
        if (fs.existsSync(localInput)) fs.unlinkSync(localInput);
        return res.status(404).send({ 
            error: `Missing Logo: ${logoPath}. Files found in folder: [${availableFiles}]. You MUST click 'Factory Rebuild' in HF Settings!` 
        });
    }

    if (!fs.existsSync(fontPath)) {
        console.error(`[CRITICAL ASSET MISSING] Could not find font at exact path: ${fontPath}`);
        if (fs.existsSync(localInput)) fs.unlinkSync(localInput);
        return res.status(404).send({ error: `Missing Font: ${fontPath}` });
    }

    console.log(`[ENGINE INITIALIZATION] Commencing render for: ${channelName}`);
    console.log(`[TARGET OUTPUT PATH]: ${outputPath}`);

    try {
        ffmpeg()
            .input(localInput)
            .input(logoPath)
            .complexFilter([
                "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[base];" +
                `[base]drawtext=fontfile='${fontPath}':text='${headline}':fontsize=32:fontcolor=white:x=60:y=1000[vtext];` +
                "[1:v]scale=220:-1[logo];" +
                "[vtext][logo]overlay=W-w-60:60[vout]"
            ])
            .outputOptions([
                '-threads 2',                  
                '-bufsize 2000k',              
                '-max_muxing_queue_size 999',  
                '-map [vout]', 
                '-c:v libx264', 
                '-preset ultrafast',           
                '-crf 28',                     
                '-c:a aac', 
                '-b:a 96k', 
                '-movflags +faststart'
            ])
            .output(outputPath)
            .on('end', () => {
                console.log(`[ENGINE SUCCESS] Finished rendering channel variant: ${channelName}`);
                if (fs.existsSync(localInput)) {
                    fs.unlinkSync(localInput);
                }
                res.status(200).send({ status: 'success', message: `Render finished for ${channelName}` });
            })
            .on('error', (err) => {
                console.error(`[ENGINE ERROR] Failed execution on variant ${channelName}:`, err.message);
                if (fs.existsSync(localInput)) fs.unlinkSync(localInput);
                res.status(500).send({ error: err.message });
            })
            .run();

    } catch (globalError) {
        console.error("[CRITICAL FAIL] Processing interrupted:", globalError.message);
        if (fs.existsSync(localInput)) fs.unlinkSync(localInput);
        return res.status(500).send({ error: "Pipeline error: " + globalError.message });
    }
});

const PORT = 7860;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Sequential Factory Server actively listening on port ${PORT}`);
});
