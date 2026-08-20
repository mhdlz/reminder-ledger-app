require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(cors());

// ✅ স্ট্যাটিক ফাইল পাথ ফিক্স (public ফোল্ডার ও রুট উভয় সাপোর্ট করবে)
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// ডাটাবেজ কানেকশন
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/myPersonalApp";

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ ডাটাবেজ সফলভাবে কানেক্ট হয়েছে!'))
    .catch(err => console.error('❌ ডাটাবেজ কানেকশন ভুল:', err));

// ডাটাবেজ স্কিমাসমূহ
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

// --- এপিআই রাউটসমূহ ---

// ১. লগইন
app.post('/api/login', async (req, res) => {
    const { pin } = req.body;
    let auth = await Auth.findOne();
    if (!auth) auth = await new Auth({ pin: '1234' }).save();

    if (auth.pin === pin) {
        res.json({ success: true, token: 'AUTH_VALID_USER' });
    } else {
        res.status(401).json({ success: false, message: 'ভুল পিন (PIN) দিয়েছেন!' });
    }
});

// ২. পিন পরিবর্তন
app.post('/api/change-pin', async (req, res) => {
    const { oldPin, newPin } = req.body;
    let auth = await Auth.findOne();
    if (!auth) auth = await new Auth({ pin: '1234' }).save();

    if (auth.pin === oldPin) {
        auth.pin = newPin;
        await auth.save();
        res.json({ success: true, message: 'পিন সফলভাবে পরিবর্তিত হয়েছে!' });
    } else {
        res.status(400).json({ success: false, message: 'পুরাতন পিনটি ভুল!' });
    }
});

// ৩. সব কন্টাক্ট এবং মোট হিসাব
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

// ৪. নতুন কন্টাক্ট যোগ
app.post('/api/persons', async (req, res) => {
    try {
        const person = new Person(req.body);
        await person.save();
        res.status(201).json({ success: true, data: person });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ৫. নির্দিষ্ট ব্যক্তির লেনদেন
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

// ৬. পাবলিক স্টেটমেন্ট
app.get('/api/public-statement/:id', async (req, res) => {
    try {
        const person = await Person.findById(req.params.id);
        if (!person) return res.status(404).json({ success: false, message: 'তথ্য পাওয়া যায়নি!' });

        const transactions = await Transaction.find({ personId: req.params.id }).sort({ date: -1 });
        let netBalance = 0;
        transactions.forEach(t => {
            if (t.type === 'TAKE') netBalance += t.amount;
            else netBalance -= t.amount;
        });

        res.json({ success: true, person, transactions, netBalance });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ৭. লেনদেন তৈরি
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

// ৮. লেনদেন এডিট
app.put('/api/transactions/:id', async (req, res) => {
    try {
        const { type, amount, note, date } = req.body;
        const updateData = { type, amount, note };
        if (date) updateData.date = new Date(date);

        await Transaction.findByIdAndUpdate(req.params.id, updateData);
        res.json({ success: true, message: 'লেনদেন আপডেট হয়েছে!' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ৯. লেনদেন ডিলিট
app.delete('/api/transactions/:id', async (req, res) => {
    try {
        await Transaction.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'লেনদেন মুছে ফেলা হয়েছে!' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ১০. রিমাইন্ডার তৈরি
app.post('/api/tasks', async (req, res) => {
    try {
        let { title, textNote, audioData, dateTime } = req.body;
        if (!title || title.trim() === '') {
            const formattedDate = new Date(dateTime).toLocaleString('bn-BD');
            title = `রিমাইন্ডার - ${formattedDate}`;
        }
        const task = new Task({ title, textNote, audioData, dateTime, isNotified: false });
        await task.save();
        res.status(201).json({ success: true, data: task });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ১১. সব রিমাইন্ডার তালিকা
app.get('/api/tasks', async (req, res) => {
    try {
        const tasks = await Task.find().sort({ dateTime: -1 });
        res.json(tasks);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ১২. রিমাইন্ডার নোটিফাইড মার্ক করা
app.patch('/api/tasks/:id/notified', async (req, res) => {
    try {
        await Task.findByIdAndUpdate(req.params.id, { isNotified: true });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ১৩. রিমাইন্ডার ডিলিট
app.delete('/api/tasks/:id', async (req, res) => {
    try {
        await Task.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'রিমাইন্ডার ডিলিট হয়েছে!' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ✅ হোম পেজ ও স্টেটমেন্ট পেজ রাউটিং
app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'public', 'index.html');
    res.sendFile(indexPath, (err) => {
        if (err) res.sendFile(path.join(__dirname, 'index.html'));
    });
});

app.get('/statement.html', (req, res) => {
    const stmtPath = path.join(__dirname, 'public', 'statement.html');
    res.sendFile(stmtPath, (err) => {
        if (err) res.sendFile(path.join(__dirname, 'statement.html'));
    });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 সার্ভার রানিং: http://localhost:${PORT}`));