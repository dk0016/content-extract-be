const express = require("express");
const axios = require("axios");
const cors = require("cors");
const dotenv = require("dotenv");
const { htmlToText } = require("html-to-text");

dotenv.config();

const app = express();
app.use(cors({
    origin: 'https://content-extract-ui.vercel.app',
    methods: ['GET', 'POST'],
}));
app.use(express.json());

const HUGGINGFACE_API_TOKEN = process.env.HUGGINGFACE_API_KEY;
const SUMMARY_MODEL = "facebook/bart-large-cnn";

// Fallback: Extract content from URL using html-to-text (for static pages)
async function fetchTextFromUrl(url) {
    try {
        const response = await axios.get(url, {
            headers: {
                "User-Agent": "Mozilla/5.0", // Helps avoid bot detection
            },
            timeout: 15000,
        });

        const rawHTML = response.data;
        const text = htmlToText(rawHTML, {
            wordwrap: 130,
            selectors: [
                { selector: 'a', format: 'inline' }, // Keep links in text
                { selector: 'img', format: 'skip' },  // Skip images
            ],
        });

        return text.slice(0, 3000); // Limit to 3000 chars for HuggingFace input
    } catch (err) {
        throw new Error("Failed to extract content from the URL.");
    }
}

// Query HuggingFace API for summarization
async function queryHuggingFace(model, input, retries = 3) {
    try {
        const response = await axios.post(
            `https://api-inference.huggingface.co/models/${model}`,
            { inputs: input },
            {
                headers: {
                    Authorization: `Bearer ${HUGGINGFACE_API_TOKEN}`,
                },
                timeout: 15000,
            }
        );
        return response.data;
    } catch (error) {
        if (retries > 0 && error.response?.status === 503) {
            await new Promise(res => setTimeout(res, 3000));
            return queryHuggingFace(model, input, retries - 1);
        }

        throw new Error("Failed to generate summary.");
    }
}

//  Generate distinct and varied key points
function generateKeyPoints(content) {
    // Split the content into smaller chunks based on sentences
    const sentences = content.split(".").map(s => s.trim()).filter(Boolean);

    // Filter out the sentences that are likely redundant or too general
    const potentialKeyPoints = sentences.filter((s) => {
        return (
            s.length > 50 && // Exclude very short sentences
            !s.includes("advertisement") && // Skip ads or promotions
            !s.toLowerCase().includes("summary") // Avoid summary-type sentences
        );
    });

    // Extract distinct key points
    const keyPoints = [];
    potentialKeyPoints.forEach((sentence) => {
        if (!keyPoints.some((keyPoint) => keyPoint.toLowerCase().includes(sentence.toLowerCase()))) {
            keyPoints.push(sentence);
        }
    });

    // If we don't have enough key points, add fallback messages
    if (keyPoints.length < 3) {
        keyPoints.push("For more details, visit the original article.");
    }

    return keyPoints.slice(0, 5); // Limit to a maximum of 5 key points
}

app.get("/", (req, res) => res.send("Server is up"));
app.get("/api/health", (req, res) => res.send("API is healthy"));

app.post("/api/extract", async (req, res) => {
    try {
        const { url } = req.body;

        if (!url || !url.startsWith("http")) {
            return res.status(400).json({ error: "Invalid URL format." });
        }


        const content = await fetchTextFromUrl(url);
        const summaryData = await queryHuggingFace(SUMMARY_MODEL, content);
        const summary = summaryData[0]?.summary_text || "Summary not available.";
        const keyPoints = generateKeyPoints(content);  // Use full content to generate key points

        res.json({
            title: new URL(url).hostname.split(".")[1],
            url,
            summary,
            keyPoints,
            language: "en",
            tags: ["ai-generated"],
            extractedAt: new Date().toISOString(),
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(process.env.PORT || 5000, () => {
    process.stdout.write(`Server running on port ${process.env.PORT || 5000}\n`);
});
