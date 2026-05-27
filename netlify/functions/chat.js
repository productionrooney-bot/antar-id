// ============================================================
// RATE LIMITING — per IP address
// Max 10 pesan per IP per jam
// Max 3 pesan per IP per menit (anti spam burst)
// ============================================================
const rateLimitStore = {};

function checkRateLimit(ip) {
  const now = Date.now();
  const HOUR = 60 * 60 * 1000;
  const MINUTE = 60 * 1000;
  const MAX_PER_HOUR = 10;
  const MAX_PER_MINUTE = 3;

  if (!rateLimitStore[ip]) {
    rateLimitStore[ip] = { requests: [] };
  }

  // Bersihkan data lebih dari 1 jam
  rateLimitStore[ip].requests = rateLimitStore[ip].requests.filter(
    (t) => now - t < HOUR
  );

  const requestsLastHour = rateLimitStore[ip].requests.length;
  const requestsLastMinute = rateLimitStore[ip].requests.filter(
    (t) => now - t < MINUTE
  ).length;

  if (requestsLastMinute >= MAX_PER_MINUTE) {
    return {
      blocked: true,
      reason: "Pelan-pelan ya kak 😅 Tunggu sebentar sebelum kirim pesan lagi.",
    };
  }

  if (requestsLastHour >= MAX_PER_HOUR) {
    const oldest = rateLimitStore[ip].requests[0];
    const resetMenit = Math.ceil((HOUR - (now - oldest)) / MINUTE);
    return {
      blocked: true,
      reason: `Wah banyak banget pesannya nih 😄 Coba lagi dalam ${resetMenit} menit ya, atau langsung order via WhatsApp!`,
    };
  }

  // Catat request ini
  rateLimitStore[ip].requests.push(now);
  return { blocked: false };
}

// Bersihkan store lama setiap 100 request (hemat memori)
let cleanupCounter = 0;
function cleanupStore() {
  cleanupCounter++;
  if (cleanupCounter % 100 !== 0) return;
  const now = Date.now();
  const HOUR = 60 * 60 * 1000;
  for (const ip in rateLimitStore) {
    rateLimitStore[ip].requests = rateLimitStore[ip].requests.filter(
      (t) => now - t < HOUR
    );
    if (rateLimitStore[ip].requests.length === 0) {
      delete rateLimitStore[ip];
    }
  }
}

// ============================================================
// MAIN HANDLER
// ============================================================
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
    // Ambil IP user
    const ip =
      event.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      event.headers["client-ip"] ||
      "unknown";

    // Cek rate limit
    cleanupStore();
    const limit = checkRateLimit(ip);
    if (limit.blocked) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ reply: limit.reason }),
      };
    }

    // Parse request
    const body = JSON.parse(event.body);
    const message = body.message;
    const history = body.history || [];

    if (!message) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ reply: "Pesan tidak boleh kosong." }),
      };
    }

    // Cek API key
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          reply: "Maaf, layanan AI sedang dalam maintenance. Silakan order langsung via WhatsApp ya!",
        }),
      };
    }

    const SYSTEM_PROMPT = `Kamu adalah asisten virtual untuk layanan lokal bernama "Antar.id" yang beroperasi di area Yosowilangun, Lumajang, Jawa Timur.

LAYANAN YANG TERSEDIA:
1. OJEK — antar jemput penumpang ke tujuan mana saja di area Yosowilangun
2. ANTAR MAKANAN — pesan makanan dari warung/restoran lokal, kurir belikan dan antarkan
3. ANTAR BELANJA — titip belanja ke pasar atau toko, kurir yang belanja dan antar
4. KIRIM PAKET — kirim dokumen, barang, atau paket lokal antar area Yosowilangun

TARIF SEMUA LAYANAN:
- Rp 2.000/km + biaya layanan Rp 1.000 per order
- Minimum order: Rp 3.000
- Contoh: 2 km = (2 x 2.000) + 1.000 = Rp 5.000

CARA KERJA ANTAR MAKANAN DAN BELANJA:
- Kurir konfirmasi harga via FOTO saat tiba di lokasi
- User bayar setelah melihat foto harga, transparan tanpa markup
- Bayar langsung ke kurir saat terima pesanan (COD)

CARA MERESPONS:
- Gunakan bahasa Indonesia yang santai, ramah, dan friendly
- Maksimal 100 kata per respons
- Untuk ojek: tanya lokasi jemput dan tujuan
- Untuk antar makanan: tanya mau pesan apa dan lokasi user
- Untuk belanja: tanya mau beli apa dan di toko atau pasar mana
- Untuk kirim paket: tanya lokasi pengirim dan penerima
- Selalu akhiri dengan ajakan konfirmasi order via WhatsApp
- JANGAN jawab pertanyaan di luar konteks layanan Antar.id`;

    // Build conversation history
    const contents = [];
    if (Array.isArray(history)) {
      history.slice(-8).forEach((msg) => {
        contents.push({
          role: msg.role === "ai" ? "model" : "user",
          parts: [{ text: msg.content }],
        });
      });
    }
    contents.push({ role: "user", parts: [{ text: message }] });

    // Panggil Gemini API
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents,
          generationConfig: {
            maxOutputTokens: 250,
            temperature: 0.7,
          },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errData = await geminiRes.json().catch(() => ({}));
      const errCode = errData?.error?.code || geminiRes.status;

      // Quota habis
      if (errCode === 429) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            reply: "Maaf, asisten AI sedang istirahat sejenak karena terlalu banyak permintaan 😅 Untuk order cepat, langsung hubungi kami via WhatsApp ya!",
          }),
        };
      }

      // Error lain
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          reply: "Maaf ada gangguan teknis sebentar. Coba lagi dalam beberapa menit atau langsung order via WhatsApp!",
        }),
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
      body: JSON.stringify({
        reply: "Maaf ada gangguan koneksi. Silakan coba lagi atau langsung order via WhatsApp!",
      }),
    };
  }
};
