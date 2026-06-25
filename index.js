const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const axios = require('axios');
const app = express();
app.use(express.json());

// Robust downloader using Axios
async function downloadFile(url, dest) {
    const writer = fs.createWriteStream(dest);
    const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'stream'
    });
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}

app.post('/render', async (req, res) => {
    const { inputUrl, outputPath, headline, logoPath } = req.body;
    const localInput = '/tmp/input.mp4';
    
    // Ensure we have a URL
    if (!inputUrl) return res.status(400).send('Missing inputUrl');

    try {
        console.log('Downloading:', inputUrl);
        await downloadFile(inputUrl, localInput);
        
        const fontPath = "/usr/local/share/fonts/Poppins-Bold.ttf";

        ffmpeg()
            .input(localInput)
            .input(logoPath)
            .complexFilter(["scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[base];[base]drawtext=fontfile='" + fontPath + "':text='" + headline + "':fontsize=32:fontcolor=white:x=60:y=1000[vtext];[1:v]scale=220:-1[logo];[vtext][logo]overlay=W-w-60:60[vout]"])
            .outputOptions(['-map [vout]', '-c:v libx264', '-preset veryfast', '-crf 23', '-c:a aac', '-b:a 128k', '-movflags +faststart'])
            .output(outputPath)
            .on('end', () => {
                fs.unlinkSync(localInput); // Clean up
                res.status(200).send({ status: 'success' });
            })
            .on('error', (err) => {
                console.error('FFmpeg Error:', err);
                res.status(500).send({ error: err.message });
            })
            .run();
    } catch (err) {
        console.error('Download Error:', err);
        res.status(500).send({ error: 'Download failed: ' + err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Worker is ready'));
