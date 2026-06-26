const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');
const app = express();

app.use(express.json());

// --- GLOBAL LOGGER ---
app.use((req, res, next) => {
    console.log(`[SYSTEM LOG] ${req.method} request incoming to path: ${req.path}`);
    next();
});

// --- SINGLE-ASSET DOWNLOAD UTILITY ---
async function downloadSourceAsset(url, dest) {
    const writer = fs.createWriteStream(dest);
    console.log(`[DOWNLOAD START] Pulling fresh asset from source URL to: ${dest}`);
    
    // Completely removed the custom httpsAgent to prevent Telegram TLS socket drops
    // Added extensive standard browser headers to bypass bot-blocking
    const response = await axios({ 
        method: 'GET', 
        url: url, 
        responseType: 'stream',
        timeout: 0, 
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Connection': 'keep-alive'
        }
    });
    
    response.data.pipe(writer);
    
    return new Promise((resolve, reject) => {
        writer.on('finish', () => {
            console.log(`[DOWNLOAD SUCCESS] Asset successfully cached at: ${dest}`);
            resolve();
        });
        writer.on('error', (err) => {
            console.error(`[DOWNLOAD CRASH] Error writing asset:`, err.message);
            reject(err);
        });
    });
}

// --- CORE SEQUENTIAL EDITING ENGINE ---
function renderSingleChannel(sourceInputPath, channelJob, fontPath) {
    return new Promise((resolve, reject) => {
        const logoPath = `/app/logos/${channelJob.channelName} Logo.png`;
        
        console.log(`[ENGINE INITIALIZATION] Commencing render for: ${channelJob.channelName}`);
        console.log(`[TARGET OUTPUT PATH]: ${channelJob.outputPath}`);

        ffmpeg()
            .input(sourceInputPath)
            .input(logoPath)
            .complexFilter([
                "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[base];" +
                `[base]drawtext=fontfile='${fontPath}':text='${channelJob.headline}':fontsize=32:fontcolor=white:x=60:y=1000[vtext];` +
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
            .output(channelJob.outputPath)
            .on('end', () => {
                console.log(`[ENGINE SUCCESS] Finished rendering channel: ${channelJob.channelName}`);
                resolve();
            })
            .on('error', (err) => {
                console.error(`[ENGINE ERROR] Failed execution on variant ${channelJob.channelName}:`, err.message);
                reject(err);
            })
            .run();
    });
}

// --- HEALTH CHECK ENDPOINT ---
app.get('*', (req, res) => {
    res.status(200).send("Sequential Video Factory is Online and Active");
});

// --- BATCH BUNDLE ENTRY ROUTE ---
app.post('*', async (req, res) => {
    console.log("[BATCH INGESTION] Multi-channel batch payload received.");
    
    const { jobs } = req.body; 

    if (!jobs || !Array.isArray(jobs) || jobs.length === 0) {
        console.error("[INVALID PAYLOAD] Request body must contain an array of jobs.");
        return res.status(400).send({ error: "Invalid payload format. 'jobs' array required." });
    }

    const batchId = crypto.randomBytes(4).toString('hex');
    const sharedSourceCachePath = `/tmp/source_cache_${batchId}.mp4`;
    const fontPath = "/usr/local/share/fonts/Poppins-Bold.ttf";
    
    const sharedSourceUrl = jobs[0].inputUrl;

    try {
        // Step 1: Download the media exactly once
        await downloadSourceAsset(sharedSourceUrl, sharedSourceCachePath);
        
        // Step 2: Loop sequentially through every job block
        for (let i = 0; i < jobs.length; i++) {
            const currentJob = jobs[i];
            console.log(`[PIPELINE QUEUE] Processing item ${i + 1} of ${jobs.length}`);
            
            await renderSingleChannel(sharedSourceCachePath, currentJob, fontPath);
        }

        // Step 3: Explicit Cleanup
        console.log(`[CLEANUP] Purging shared cache asset from temporary memory storage...`);
        if (fs.existsSync(sharedSourceCachePath)) {
            fs.unlinkSync(sharedSourceCachePath);
        }

        console.log("[BATCH SUCCESS] All requested channel outputs have been cleanly processed sequentially.");
        return res.status(200).send({ status: "success", message: "All variants processed sequentially." });

    } catch (globalError) {
        console.error("[CRITICAL GLOBAL FAIL] Batch pipeline processing was interrupted:", globalError.message);
        
        if (fs.existsSync(sharedSourceCachePath)) {
            fs.unlinkSync(sharedSourceCachePath);
        }
        return res.status(500).send({ error: "Sequential pipeline runtime failure: " + globalError.message });
    }
});

// --- SYSTEM INITIALIZATION NETWORK BINDINGS ---
const PORT = 7860;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Sequential Factory Server actively listening on port ${PORT}`);
});
