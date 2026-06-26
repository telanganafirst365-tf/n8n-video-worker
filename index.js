const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const axios = require('axios');
const app = express();

app.use(express.json());

// Log every single request to help debug
app.use((req, res, next) => {
    console.log(`[REQUEST] ${req.method} ${req.url}`);
    next();
});

// Download utility
async function downloadFile(url, dest) {
    const writer = fs.createWriteStream(dest);
    const response = await axios({ method: 'GET', url: url, responseType: 'stream' });
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}

app.get('/', (req, res) => {
    res.status(200).send("Factory is Online");
});

app.post('/render', async (req, res) => {
    console.log("Render request received!");
    const { inputUrl, outputPath, headline, channelName } = req.body;
    const localInput = '/tmp/input.mp4';
    const logoPath = `/app/logos/${channelName} Logo.png`;
    const fontPath = "/usr/local/share/fonts/Poppins-Bold.ttf";

    try {
        await downloadFile(inputUrl, localInput);
        
        ffmpeg()
            .input(localInput)
            .input(logoPath)
            .complexFilter(["scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[base];[base]drawtext=fontfile='" + fontPath + "':text='" + headline + "':fontsize=32:fontcolor=white:x=60:y=1000[vtext];[1:v]scale=220:-1[logo];[vtext][logo]overlay=W-w-60:60[vout]"])
            .outputOptions(['-threads 1', '-bufsize 1000k', '-max_muxing_queue_size 999', '-map [vout]', '-c:v libx264', '-preset ultrafast', '-crf 28', '-c:a aac', '-b:a 96k', '-movflags +faststart'])
            .output(outputPath)
            .on('end', () => {
                if (fs.existsSync(localInput)) fs.unlinkSync(localInput);
                res.status(200).send({ status: 'success' });
            })
            .on('error', (err) => res.status(500).send({ error: err.message }))
            .run();
    } catch (err) {
        res.status(500).send({ error: err.message });
    }
});

const PORT = 7860;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is actively listening on port ${PORT}`);
});
