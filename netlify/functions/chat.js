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
    const { message, history } = JSON.parse(event.body);

    if (!message) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Message required" }),
      };
    }

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "API key not configured" }),
      };
    }

    const AREA = "Yosowilangun, Lumajang, Jawa Timur";
    const ONGKIR_PER_KM = 2000;
    const BIAYA_LAYANAN = 1000;

    const SYSTEM_PROMPT = `Kamu adalah asisten virtual untuk layanan lokal bernama "Antar.id" yang beroperasi di area ${AREA}.

LAYANAN YANG TERSEDIA:
1. 🛵 OJEK — antar jemput penumpang ke tujuan mana saja di area Yosowilangun
2. 🍜 ANTAR MAKANAN — pesan makanan dari warung/restoran lokal, kurir belikan & antarkan
3. 🛒 ANTAR BELANJA — titip belanja ke pasar atau toko, kurir yang belanja & antar
4. 📦 KIRIM PAKET — kirim dokumen, barang, atau paket lokal antar area Yosowilangun

TARIF SEMUA LAYANAN:
- Rp ${ONGKIR_PER_KM.toLocaleString("id-ID")}/km + biaya layanan Rp ${BIAYA_LAYANAN.toLocaleString("id-ID")}
- Minimum order: Rp 3.000
- Contoh: 2 km = (2 × 2.000) + 1.000 = Rp 5.000

CARA KERJA ANTAR MAKANAN & BELANJA:
- Kurir konfirmasi harga via FOTO saat tiba di lokasi
- User bayar setelah melihat foto harga (transparan, tidak ada markup tersembunyi)
- Bayar langsung ke kurir saat terima pesanan (COD)

PENTING — CARA MERESPONS:
- Gunakan bahasa Indonesia yang santai, ramah, dan friendly
- Maksimal 120 kata per respons agar ringkas di mobile
- Jika user menyebut lokasi atau tujuan, sebutkan estimasi jarak dan ongkir
- Untuk ojek: tanya lokasi jemput & tujuan
- Untuk antar makanan: tanya mau pesan apa & lokasi user
- Untuk belanja: tanya mau beli apa & di toko/pasar mana
- Untuk kirim paket: tanya lokasi pengirim & penerima
- Selalu akhiri dengan ajakan konfirmasi order via WhatsApp
- JANGAN jawab pertanyaan di luar konteks layanan Antar.id`;

    // Build conversation history for Gemini
    const contents = [];
    if (history && Array.isArray(history)) {
      history.forEach((msg) => {
        contents.push({
          role: msg.role === "ai" ? "model" : "user",
          parts: [{ text: msg.content }],
        });
      });
    }
    contents.push({ role: "user", parts: [{ text: message }] });

    const response = await fetch(
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

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    const reply =
      data.candidates?.[0]?.content?.parts?.[0]?.text ||
      "Maaf, ada gangguan sebentar. Silakan coba lagi atau hubungi kami via WhatsApp ya!";

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ reply }),
    };
  } catch (err) {
    console.error("Function error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        reply:
          "😅 Ups, ada gangguan teknis. Coba lagi sebentar ya, atau langsung hubungi kami via WhatsApp!",
      }),
    };
  }
};
