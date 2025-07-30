const { Client, RemoteAuth } = require('whatsapp-web.js');
const { MongoStore } = require('wwebjs-mongo');
const mongoose = require('mongoose');
const qrcode = require('qrcode-terminal');
const fs = require('fs');

require('dotenv').config();
const MONGO_URI = process.env.MONGO_URI;

(async () => {
  try {
    // 1. Koneksi ke MongoDB
    await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
    console.log('✅ Terhubung ke MongoDB Atlas');

    // 2. Setup store session
    const store = new MongoStore({ mongoose });

    // 3. Setup WhatsApp Client dengan RemoteAuth
    const client = new Client({
      authStrategy: new RemoteAuth({
        store,
        clientId: 'bot-jateng',
        backupSyncIntervalMs: 300000, // 5 menit
        dataPath: './.wwebjs_auth'
      }),
      puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        headless: true
      }
    });

    // 4. Generate QR
    client.on('qr', (qr) => {
      console.log('📱 Scan QR berikut:');
      qrcode.generate(qr, { small: true });
    });

    client.on('ready', () => {
      console.log('✅ Bot WhatsApp siap digunakan (RemoteAuth)');
    });

    const session = new Map();

    function resetSession(pengirim) {
      session.set(pengirim, { status: 'done' });
    }

    function dailyReset() {
      session.clear();
      console.log('🔄 Semua sesi telah direset (harian)');
    }

    function scheduleDailyReset() {
      const now = new Date();
      const resetTime = new Date();
      resetTime.setHours(24, 0, 0, 0);
      const timeout = resetTime - now;
      setTimeout(() => {
        dailyReset();
        scheduleDailyReset();
      }, timeout);
    }

    scheduleDailyReset();

    const menuAwal = `Halo! Terima kasih telah menghubungi *Balai Besar Pelaksanaan Jalan Nasional Jawa Tengah – DI Yogyakarta*. 🙏\n\nSilakan pilih layanan berikut dengan membalas angka:\n\n1️⃣ Permohonan Informasi Publik  \n2️⃣ Peminjaman Alat Konstruksi dengan Cara Sewa  \n3️⃣ Perizinan Pemanfaatan Bagian-Bagian Jalan Nasional  \n4️⃣ Sertifikasi AMP  \n5️⃣ Permohonan Kerja Praktik / Magang  \n6️⃣ Layanan untuk Penyandang Disabilitas dan Kelompok Rentan\n\nTerima kasih.`;

    client.on('message', async (msg) => {
      try {
        if (!msg || !msg.body || !msg.from) return;

        const pesan = msg.body.trim().toLowerCase();
        const pengirim = msg.from;
        console.log(`📩 ${pengirim}: "${pesan}"`);
        const userData = session.get(pengirim);

        if (userData?.status === 'done') {
          if (pesan === '0') {
            await msg.reply(menuAwal);
            session.set(pengirim, { status: 'menu' });
          }
          return;
        }

        if (!userData) {
          await msg.reply(menuAwal);
          session.set(pengirim, { status: 'menu' });
          return;
        }

        if (userData.status === 'menu') {
          if (['1', '2', '3', '4', '5'].includes(pesan)) {
            await msg.reply(`✅ *Terima kasih!* Permintaan Anda akan segera ditindaklanjuti oleh petugas kami.\n\nKetik *0* jika ingin kembali ke menu layanan.`);
            resetSession(pengirim);
          } else if (pesan === '6') {
            await msg.reply(`Terima kasih telah memilih *Layanan untuk Penyandang Disabilitas dan Kelompok Rentan*. 🙏\n\nApakah Anda penyandang disabilitas atau memiliki kebutuhan khusus?  \nBalas: *Ya* / *Tidak*`);
            session.set(pengirim, { status: 'disabilitas-status' });
          } else {
            await msg.reply('Mohon pilih salah satu layanan dengan angka 1 hingga 6. 🙏');
          }
          return;
        }

        if (userData.status === 'disabilitas-status') {
          if (pesan === 'ya') {
            await msg.reply(`• Jenis disabilitas atau kebutuhan khusus yang Anda miliki:`);
            session.set(pengirim, { status: 'disabilitas-q1' });
          } else if (pesan === 'tidak') {
            await msg.reply(`✅ *Terima kasih!* Informasi Anda akan segera ditindaklanjuti oleh petugas kami.\n\nKetik *0* jika ingin kembali ke menu layanan.`);
            resetSession(pengirim);
          } else {
            await msg.reply(`Mohon balas dengan *Ya* atau *Tidak* agar kami bisa lanjut membantu. 🙏`);
          }
          return;
        }

        if (userData.status === 'disabilitas-q1') {
          session.set(pengirim, { status: 'disabilitas-q2', jawaban1: pesan });
          await msg.reply(`• Apakah Anda membutuhkan layanan tambahan? (misalnya, penerjemah bahasa isyarat):`);
          return;
        }

        if (userData.status === 'disabilitas-q2') {
          session.set(pengirim, { status: 'disabilitas-q3', jawaban1: userData.jawaban1, jawaban2: pesan });
          await msg.reply(`• Apakah ada aksesibilitas lain yang diperlukan untuk konsultasi?:`);
          return;
        }

        if (userData.status === 'disabilitas-q3') {
          const jawaban1 = userData.jawaban1;
          const jawaban2 = userData.jawaban2;
          const jawaban3 = pesan;

          await msg.reply(`✅ *Terima kasih!* Informasi Anda akan segera ditindaklanjuti oleh petugas kami.\n\nKetik *0* jika ingin kembali ke menu layanan.`);
          resetSession(pengirim);
          return;
        }

        await msg.reply(`Mohon selesaikan proses sebelumnya sebelum mengirim pesan baru. 🙏`);
      } catch (err) {
        console.error("❌ Terjadi error saat menangani pesan:", err);
      }
    });

    client.initialize();
  } catch (err) {
    console.error('❌ Gagal inisialisasi:', err);
  }
})();

// Tangani error tak terduga seperti file zip hilang
process.on('uncaughtException', (err) => {
  if (err.code === 'ENOENT' && err.path?.includes('RemoteAuth.zip')) {
    console.warn('⚠️ File RemoteAuth.zip tidak ditemukan. Melanjutkan tanpa backup lokal...');
  } else {
    console.error('❌ Uncaught Exception:', err);
    process.exit(1);
  }
});

const express = require('express');
const healthApp = express();

healthApp.get('/healthz', (req, res) => {
  res.status(200).send('OK');
});

const PORT = process.env.PORT || 3000;
healthApp.listen(PORT, () => {
  console.log(`🌐 Endpoint /healthz aktif di http://localhost:${PORT}/healthz`);
});