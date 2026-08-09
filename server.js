const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const cron = require('node-cron');
const http = require('http');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const app = express();
app.use(express.json({ limit: '15mb' }));
app.use(cors());
app.use(express.static('public'));

// ডাটাবেজ কানেকশন
const MONGO_URI = "mongodb+srv://mahidulworld_db_user:DXXiMV2Czj3pRmQj@cluster0.jmmy9qc.mongodb.net/myPersonalApp?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
    .then(() => console.log('ডাটাবেজ কানেক্টেড!'))
    .catch(err => console.error('ডাটাবেজ ভুল:', err));

// স্কিমাসমূহ
const Auth = mongoose.model('Auth', new mongoose.Schema({ pin: { type: String, default: '1234' } }));

const Person = mongoose.model('Person', new mongoose.Schema({
    name: { type: String, required: true },
    phone: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now }
}));

const Transaction = mongoose.model('Transaction', new mongoose.Schema({
    personId: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', required: true },
    type: { type: String, enum: ['GIVE', 'TAKE'], required: true },
    amount: { type: Number, required: true },
    note: { type: String, default: '' },
    date: { type: Date, default: Date.now }
}));

const Task = mongoose.model('Task', new mongoose.Schema({
    title: { type: String, default: '' },
    textNote: { type: String, default: '' },
    audioData: { type: String, default: '' },
    dateTime: { type: Date, required: true },
    isNotified: { type: Boolean, default: false }
}));

// --- পার্মানেন্ট হোয়াটসঅ্যাপ বট সেটআপ (Linux Cloud Compatible) ---
const whatsapp = new Client({
    authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ]
    }
});

let isWhatsAppReady = false;
let latestQRCode = '';

whatsapp.on('qr', (qr) => {
    console.log('⚡ নতুন QR Code এসেছে:');
    qrcode.generate(qr, { small: true });
    latestQRCode = qr;
});

whatsapp.on('ready', () => {
    console.log('✅ হোয়াটসঅ্যাপ বট পার্মানেন্টলি কানেক্টেড!');
    isWhatsAppReady = true;
    latestQRCode = '';
});

whatsapp.on('disconnected', () => {
    isWhatsAppReady = false;
    whatsapp.initialize();
});
whatsapp.initialize();

// মোবাইল থেকে QR Code স্ক্যান করার জন্য ওয়েব পেজ
app.get('/qr', (req, res) => {
    if (isWhatsAppReady) {
        return res.send('<h2 style="font-family:sans-serif; text-align:center; margin-top:50px; color:green;">✅ হোয়াটসঅ্যাপ ইতোমধ্যে কানেক্টেড আছে!</h2>');
    }
    if (!latestQRCode) {
        return res.send('<h2 style="font-family:sans-serif; text-align:center; margin-top:50px;">QR Code তৈরি হচ্ছে... ১০ সেকেন্ড পর পেজ রিফ্রেশ করুন।</h2>');
    }
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(latestQRCode)}`;
    res.send(`
        <div style="font-family:sans-serif; text-align:center; padding:20px;">
            <h2>মোবাইল দিয়ে হোয়াটসঅ্যাপ QR কোড স্ক্যান করুন</h2>
            <img src="${qrImageUrl}" style="border:10px solid #eee; rounded:10px;" />
            <p>আপনার ফোনের WhatsApp > Linked Devices এ গিয়ে স্ক্যান করুন।</p>
        </div>
    `);
});

// --- এপিআই সমুহ ---

app.post('/api/login', async (req, res) => {
    const { pin } = req.body;
    let auth = await Auth.findOne();
    if (!auth) auth = await new Auth({ pin: '1234' }).save();

    if (auth.pin === pin) res.json({ success: true, token: 'AUTH_SECRET_TOKEN_123' });
    else res.status(401).json({ success: false, message: 'ভুল পিন (PIN) দিয়েছেন!' });
});

app.post('/api/change-pin', async (req, res) => {
    const { oldPin, newPin } = req.body;
    let auth = await Auth.findOne();
    if (!auth) auth = await new Auth({ pin: '1234' }).save();

    if (auth.pin === oldPin) {
        auth.pin = newPin;
        await auth.save();
        res.json({ success: true, message: 'পিন পরিবর্তিত হয়েছে!' });
    } else {
        res.status(400).json({ success: false, message: 'পুরাতন পিনটি ভুল!' });
    }
});

app.get('/api/persons', async (req, res) => {
    try {
        const persons = await Person.find().sort({ name: 1 });
        const result = await Promise.all(persons.map(async (p) => {
            const txs = await Transaction.find({ personId: p._id });
            let netBalance = 0;
            txs.forEach(t => {
                if (t.type === 'TAKE') netBalance += t.amount;
                else netBalance -= t.amount;
            });
            return { _id: p._id, name: p.name, phone: p.phone, netBalance, totalTransactions: txs.length };
        }));
        res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/persons', async (req, res) => {
    try {
        const person = new Person(req.body);
        await person.save();
        res.status(201).json({ success: true, data: person });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/persons/:id/transactions', async (req, res) => {
    try {
        const person = await Person.findById(req.params.id);
        const transactions = await Transaction.find({ personId: req.params.id }).sort({ date: -1 });
        let netBalance = 0;
        transactions.forEach(t => {
            if (t.type === 'TAKE') netBalance += t.amount;
            else netBalance -= t.amount;
        });
        res.json({ person, transactions, netBalance });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/public-statement/:id', async (req, res) => {
    try {
        const person = await Person.findById(req.params.id);
        if (!person) return res.status(404).json({ success: false, message: 'পাওয়া যায়নি' });

        const transactions = await Transaction.find({ personId: req.params.id }).sort({ date: -1 });
        let netBalance = 0;
        transactions.forEach(t => {
            if (t.type === 'TAKE') netBalance += t.amount;
            else netBalance -= t.amount;
        });

        res.json({ success: true, person, transactions, netBalance });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/transactions', async (req, res) => {
    try {
        const { personId, type, amount, note, date } = req.body;
        const txData = { personId, type, amount, note };
        if (date) txData.date = new Date(date);

        const tx = new Transaction(txData);
        await tx.save();
        res.status(201).json({ success: true, data: tx });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/transactions/:id', async (req, res) => {
    try {
        const { type, amount, note, date } = req.body;
        const updateData = { type, amount, note };
        if (date) updateData.date = new Date(date);

        await Transaction.findByIdAndUpdate(req.params.id, updateData);
        res.json({ success: true, message: 'আপডেট হয়েছে!' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/transactions/:id', async (req, res) => {
    try {
        await Transaction.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'ডিলিট হয়েছে!' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/send-whatsapp-summary', async (req, res) => {
    try {
        const { personId } = req.body;
        const person = await Person.findById(personId);
        const txs = await Transaction.find({ personId }).sort({ date: 1 });

        if (!person || !person.phone) return res.status(400).json({ message: 'ফোন নম্বর দেওয়া নেই!' });

        let totalDue = 0;
        txs.forEach(t => {
            if (t.type === 'TAKE') totalDue += t.amount;
            else totalDue -= t.amount;
        });

        const last5Txs = txs.slice(-5);
        let detailsText = '';
        last5Txs.forEach((t, index) => {
            const d = new Date(t.date).toLocaleDateString('bn-BD');
            if (t.type === 'TAKE') {
                detailsText += `${index + 1}. ${d}: +৳${t.amount} (${t.note || 'বাকি'})\n`;
            } else {
                detailsText += `${index + 1}. ${d}: -৳${t.amount} (${t.note || 'পরিশোধ'})\n`;
            }
        });

        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const fullHost = `${protocol}://${req.headers.host}`;
        const statementUrl = `${fullHost}/statement.html?id=${personId}`;

        if (isWhatsAppReady) {
            let formattedPhone = person.phone.replace(/[^0-9]/g, '');
            if (formattedPhone.startsWith('0')) formattedPhone = '88' + formattedPhone;
            const chatId = `${formattedPhone}@c.us`;

            const message = `📋 *হিসাব বিবরণী - ${person.name}*\n\n` +
                            `*সর্বশেষ ৫টি লেনদেন:*\n${detailsText}\n` +
                            `-----------------------\n` +
                            `*সর্বমোট বকেয়া দেনা: ৳${totalDue}*\n\n` +
                            `🔗 *সম্পূর্ণ হিসাব দেখতে নিচে ক্লিক করুন:*\n${statementUrl}`;

            await whatsapp.sendMessage(chatId, message);
            res.json({ success: true, message: 'হোয়াটসঅ্যাপে ৫টি লেনদেন ও স্টেটমেন্ট লিংক পাঠানো হয়েছে!' });
        } else {
            res.status(400).json({ message: 'হোয়াটসঅ্যাপ বট রেডি নেই! /qr পেজে গিয়ে স্ক্যান করুন।' });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/tasks', async (req, res) => {
    try {
        let { title, textNote, audioData, dateTime } = req.body;
        if (!title || title.trim() === '') {
            const formattedDate = new Date(dateTime).toLocaleString('bn-BD');
            title = `Untitled - ${formattedDate}`;
        }
        const task = new Task({ title, textNote, audioData, dateTime });
        await task.save();
        res.status(201).json({ success: true, data: task });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// সব রিমাইন্ডার ব্যাক দেওয়া (গায়েব হওয়া বন্ধ করা হলো)
app.get('/api/tasks', async (req, res) => {
    const tasks = await Task.find().sort({ dateTime: -1 });
    res.json(tasks);
});

app.delete('/api/tasks/:id', async (req, res) => {
    await Task.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'রিমাইন্ডার মুছে ফেলা হয়েছে!' });
});

// ক্রন জব
cron.schedule('* * * * *', async () => {
    const now = new Date();
    const pendingTasks = await Task.find({ dateTime: { $lte: now }, isNotified: false });
    pendingTasks.forEach(async (task) => {
        console.log(`⏰ এলার্ম: ${task.title}`);
        task.isNotified = true;
        await task.save();
    });
});

// --- ২৪/৭ অটো সেলফ-পিং (Render-কে সজাগ রাখার জন্য) ---
setInterval(() => {
    http.get('http://localhost:5000/api/persons', (res) => {
        console.log('🔄 সেলফ পিং: সার্ভার সজাগ আছে!');
    });
}, 8 * 60 * 1000); // প্রতি ৮ মিনিটে পিং করবে

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`সার্ভার চলছে পোর্ট ${PORT}-এ...`));