const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const axios = require('axios');
const https = require('https');
const crypto = require('crypto');
const app = express();

app.use(express.json());

// --- GLOBAL LOGGER ---
app.use((req, res, next) => {
    console.log(`[REQUEST RECEIVED] Method: ${req.method} | Path: ${req.path}`);
    next();
});

// --- TLS CONNECTION POOLING ---
const httpsAgent = new https.Agent({  
  keepAlive: true,
  maxSockets: 25 // Increased socket availability for higher concurrency stability
});

// Download utility
async function downloadFile(url, dest) {
    const writer = fs.createWriteStream(dest);
    console.log(`[NETWORK] Starting multi-stream download to target path: ${dest}`);
    
    const response = await axios({ 
        method: 'GET', 
        url: url, 
        responseType: 'stream',
        httpsAgent: httpsAgent,
        timeout: 0, // CRITICAL: Disables the timeout constraint entirely so large parallel media streams don't drop
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': '*/*'
        }
    });
    
    response.data.pipe(writer);
    
    return new Promise((resolve, reject) => {
        writer.on('finish', () => {
            console.log(`[NETWORK SUCCESS] Asset successfully cached to: ${dest}`);
            resolve();
        });
        writer.on('error', (err) => {
            console.error(`[NETWORK ERROR] Download failed for destination ${dest}:`, err.message);
            reject(err);
        });
    });
}

// GET request handler for simple browser health checks
app.get('*', (req, res) => {
    res.status(200).send("Factory is Online and Active");
});

// Catch-all POST route
app.post('*', async (req, res) => {
    console.log("[PIPELINE START] Processing payload for target variant:", req.body.channelName);
    
    const { inputUrl, outputPath, headline, channelName } = req.body;
    
    if (!inputUrl || !outputPath || !headline || !channelName) {
        console.error("[ERROR] Missing parameters in payload configuration");
        return res.status(400).send({ error: "Missing required parameters in body" });
    }

    const uniqueId = crypto.randomBytes(4).toString('hex');
    const localInput = `/tmp/input_${uniqueId}.mp4`;
    
    const logoPath = `/app/logos/${channelName} Logo.png`;
    const fontPath = "/usr/local/share/fonts/Poppins-Bold.ttf";

    try {
        console.log(`[STATUS] [${channelName}] Downloading raw video asset...`);
        await downloadFile(inputUrl, localInput);
        
        console.log(`[STATUS] [${channelName}] Initializing FFmpeg filter pipeline...`);
        ffmpeg()
            .input(localInput)
            .input(logoPath)
            .complexFilter([
                "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[base];" +
                "[base]drawtext=fontfile='" + fontPath + "':text='" + headline + "':fontsize=32:fontcolor=white:x=60:y=1000[vtext];" +
                "[1:v]scale=220:-1[logo];" +
                "[vtext][logo]overlay=W-w-60:60[vout]"
            ])
            .outputOptions([
                '-threads 2',                  
                '-bufsize 2000k', // Expanded structural buffer space to optimize processing speed under 16GB overhead             
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
                console.log(`[SUCCESS] [${channelName}] Rendering complete. Cleaning up workspace...`);
                if (fs.existsSync(localInput)) {
                    fs.unlinkSync(localInput);
                }
                res.status(200).send({ status: 'success' });
            })
            .on('error', (err) => {
                console.error(`[FFMPEG CORE ERROR - ${channelName}]:`, err.message);
                if (fs.existsSync(localInput)) fs.unlinkSync(localInput);
                res.status(500).send({ error: err.message });
            })
            .run();
    } catch (err) {
        console.error(`[SYSTEM ERROR - ${channelName}]:`, err.message);
        if (fs.existsSync(localInput)) fs.unlinkSync(localInput);
        res.status(500).send({ error: 'Process execution failed: ' + err.message });
    }
});

// Explicit binding to required Hugging Face network conditions
const PORT = 7860;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is actively listening on port ${PORT}`);
});
