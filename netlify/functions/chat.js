exports.handler = async function (event, context) {
  // Only allow POST
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  // CORS headers
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  // Handle preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  try {
    const body = JSON.parse(event.body);
    const message = body.message;
    const history = body.history || [];

    if (!message) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ reply: "❌ DEBUG: Pesan kosong tidak diterima." }),
      };
    }

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

    // DEBUG: Cek apakah API key ada
    if (!GEMINI_API_KEY) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ reply: "❌ DEBUG: GEMINI_API_KEY tidak ditemukan di environment variables. Pastikan sudah diset di Netlify." }),
      };
    }

    // DEBUG: Konfirmasi key ada (tampilkan 6 karakter pertama saja)
    const keyPreview = GEMINI_API_KEY.substring(0, 6) + "...";

    const SYSTEM_PROMPT = `Kamu adalah asisten virtual untuk layanan lokal bernama "Antar.id" yang beroperasi di area Yosowilangun, Lumajang, Jawa Timur.

LAYANAN YANG TERSEDIA:
1. 🛵 OJEK — antar jemput penumpang ke tujuan mana saja di area Yosowilangun
2. 🍜 ANTAR MAKANAN — pesan makanan dari warung/restoran lokal, kurir belikan & antarkan
3. 🛒 ANTAR BELANJA — titip belanja ke pasar atau toko, kurir yang belanja & antar
4. 📦 KIRIM PAKET — kirim dokumen, barang, atau paket lokal antar area Yosowilangun

TARIF SEMUA LAYANAN:
- Rp 2.000/km + biaya layanan Rp 1.000 per order
- Minimum order: Rp 3.000
- Contoh: 2 km = (2 x 2.000) + 1.000 = Rp 5.000

CARA KERJA ANTAR MAKANAN & BELANJA:
- Kurir konfirmasi harga via FOTO saat tiba di lokasi
- User bayar setelah melihat foto harga (transparan, tidak ada markup tersembunyi)
- Bayar langsung ke kurir saat terima pesanan (COD)

PENTING:
- Gunakan bahasa Indonesia yang santai, ramah, dan friendly
- Maksimal 120 kata per respons
- Selalu akhiri dengan ajakan konfirmasi order via WhatsApp
- JANGAN jawab pertanyaan di luar konteks layanan Antar.id`;

    // Build conversation history
    const contents = [];
    if (Array.isArray(history)) {
      history.forEach((msg) => {
        contents.push({
          role: msg.role === "ai" ? "model" : "user",
          parts: [{ text: msg.content }],
        });
      });
    }
    contents.push({ role: "user", parts: [{ text: message }] });

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents,
          generationConfig: {
            maxOutputTokens: 300,
            temperature: 0.7,
          },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ reply: `❌ DEBUG: Gemini API error ${geminiRes.status}. Detail: ${errText.substring(0, 200)}` }),
      };
    }

    const data = await geminiRes.json();
    const reply =
      data.candidates?.[0]?.content?.parts?.[0]?.text ||
      "Maaf, ada gangguan sebentar. Silakan coba lagi atau hubungi kami via WhatsApp ya!";

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ reply }),
    };

  } catch (err) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ reply: `❌ DEBUG ERROR: ${err.message}` }),
    };
  }
};
