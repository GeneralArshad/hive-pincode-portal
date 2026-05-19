import express from 'express';
import cors from 'cors';
import { MongoClient, ObjectId } from 'mongodb';

const app  = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGODB_URI;
const DB_NAME   = process.env.DB_NAME || 'hive-pincode';
const COLL      = 'pincoderequests';

app.use(cors());
app.use(express.json());

// ── MongoDB connection ──────────────────────────────────────
let db;
const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 5000 });

async function connectDB() {
  await client.connect();
  db = client.db(DB_NAME);
  console.log(`✅ MongoDB connected → ${DB_NAME}`);
}

// ── Health ──────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// ── GET /api/stats ──────────────────────────────────────────
app.get('/api/stats', async (_, res) => {
  try {
    const [total, pending, approved, rejected] = await Promise.all([
      db.collection(COLL).countDocuments(),
      db.collection(COLL).countDocuments({ status: 'pending' }),
      db.collection(COLL).countDocuments({ status: 'approved' }),
      db.collection(COLL).countDocuments({ status: 'rejected' }),
    ]);
    res.json({ total, pending, approved, rejected });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/pincode-requests ───────────────────────────────
app.get('/api/pincode-requests', async (_, res) => {
  try {
    const docs = await db.collection(COLL)
      .find()
      .sort({ createdAt: -1 })
      .limit(2000)
      .toArray();
    res.json(docs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/pincode-requests ──────────────────────────────
app.post('/api/pincode-requests', async (req, res) => {
  try {
    const {
      mrName, mrEmployeeId, mrTerritory, pincode, areaName,
      state, reason, division, requestType, pincodes
    } = req.body;

    if (!mrEmployeeId || !pincode) {
      return res.status(400).json({ success: false, message: 'mrEmployeeId and pincode are required.' });
    }

    const doc = {
      mrName:       mrName       || '',
      mrEmployeeId: mrEmployeeId.toUpperCase(),
      mrTerritory:  mrTerritory  || '—',
      pincode,
      areaName:     areaName     || '',
      state:        state        || '',
      reason:       reason       || '',
      division:     division     || '',
      requestType:  requestType  || 'add',   // 'add' | 'remove'
      pincodes:     pincodes     || [pincode],
      status:       'pending',
      createdAt:    new Date(),
    };

    const result = await db.collection(COLL).insertOne(doc);
    res.json({ success: true, id: result.insertedId });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── PATCH /api/pincode-requests/:id ────────────────────────
app.patch('/api/pincode-requests/:id', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['pending','approved','rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status.' });
    }
    await db.collection(COLL).updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { status, updatedAt: new Date() } }
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/employees/:code/pincodes ──────────────────────
// Returns the employee's approved add-requests as their assigned pincode list.
// This is the source of truth until pincodes are synced from the SFA system directly.
app.get('/api/employees/:code/pincodes', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const docs = await db.collection(COLL).find({
      mrEmployeeId: code,
      status: 'approved',
      $or: [{ requestType: 'add' }, { requestType: { $exists: false } }]
    }).sort({ createdAt: -1 }).toArray();

    const pincodes = docs.map(d => ({
      pincode:  d.pincode,
      area:     d.areaName || '—',
      addedOn:  d.createdAt || null,
    }));

    res.json({ code, pincodes });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Start ───────────────────────────────────────────────────
connectDB()
  .then(() => app.listen(PORT, () => console.log(`🚀 hive-pincode-api on :${PORT}`)))
  .catch(err => { console.error('DB connection failed:', err); process.exit(1); });
