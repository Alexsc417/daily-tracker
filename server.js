const express = require('express');
const path = require('path');
const webpush = require('web-push');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── VAPID KEYS ────────────────────────────────────────────────────────
// On first deploy, keys are generated and logged to Railway console.
// Copy them into Railway env vars (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
// so they stay consistent across restarts.
let vapidKeys;
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  vapidKeys = {
    publicKey: process.env.VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY,
  };
} else {
  vapidKeys = webpush.generateVAPIDKeys();
  console.log('=== VAPID KEYS GENERATED — add these to Railway env vars ===');
  console.log('VAPID_PUBLIC_KEY=' + vapidKeys.publicKey);
  console.log('VAPID_PRIVATE_KEY=' + vapidKeys.privateKey);
  console.log('=============================================================');
}

webpush.setVapidDetails(
  'mailto:carveralex24@gmail.com',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

// ── STATE (in-memory, single user) ───────────────────────────────────
let pushSubscription = null;
let tasksDoneDate = null; // 'YYYY-MM-DD' when all tasks completed

// Outreach stats — updated by sync script, served to app on load
let outreachStats = {
  alltime: { sent: 0, opened: 0, replies: 0 },
  weekly:  { sent: 0, opened: 0, replies: 0 },
  templates: {
    'free-demo':  { sent: 0, opened: 0, replies: 0 },
    'pain-point': { sent: 0, opened: 0, replies: 0 },
    'curiosity':  { sent: 0, opened: 0, replies: 0 },
  },
  syncedAt: null,
};

// ── HELPERS ───────────────────────────────────────────────────────────
function getTodayUK() {
  const d = new Date();
  const uk = new Date(d.toLocaleString('en-GB', { timeZone: 'Europe/London' }));
  const y = uk.getFullYear();
  const m = String(uk.getMonth() + 1).padStart(2, '0');
  const day = String(uk.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getDayOfWeekUK() {
  // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  const d = new Date();
  const uk = new Date(d.toLocaleString('en-GB', { timeZone: 'Europe/London' }));
  return uk.getDay();
}

async function sendPush(payload) {
  if (!pushSubscription) return;
  try {
    await webpush.sendNotification(pushSubscription, JSON.stringify(payload));
    console.log('Push sent:', payload.title);
  } catch (err) {
    console.error('Push failed:', err.statusCode, err.message);
    if (err.statusCode === 410 || err.statusCode === 404) {
      // Subscription expired/invalid — clear it
      pushSubscription = null;
    }
  }
}

// ── API ROUTES ────────────────────────────────────────────────────────
app.get('/api/vapid-public-key', (req, res) => {
  res.json({ publicKey: vapidKeys.publicKey });
});

app.post('/api/subscribe', (req, res) => {
  pushSubscription = req.body;
  console.log('Push subscription saved');
  res.json({ ok: true });
});

app.post('/api/tasks-complete', (req, res) => {
  tasksDoneDate = req.body.date;
  console.log('Tasks marked complete for', tasksDoneDate);
  res.json({ ok: true });
});

app.post('/api/tasks-reset', (req, res) => {
  tasksDoneDate = null;
  res.json({ ok: true });
});

// ── OUTREACH STATS API ────────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  res.json(outreachStats);
});

app.post('/api/stats', (req, res) => {
  const { alltime, weekly, templates } = req.body;
  if (alltime)   outreachStats.alltime   = alltime;
  if (weekly)    outreachStats.weekly    = weekly;
  if (templates) outreachStats.templates = templates;
  outreachStats.syncedAt = new Date().toISOString();
  console.log('Stats updated:', outreachStats);
  res.json({ ok: true });
});

app.post('/api/test-notification', async (req, res) => {
  try {
    await sendPush({
      title: 'Test notification 💜',
      body: "It's working Alex — push notifications are live!",
      tag: 'test',
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── NOTIFICATION MESSAGES ─────────────────────────────────────────────
const morningMessages = [
  { title: 'Morning Alex 💪', body: "ChatAero won't sell itself. Let's get after it." },
  { title: 'New day, new chance 🌅', body: "One email today could be your first client. Open the tracker." },
  { title: 'Rise and grind 🔥', body: "Every dental clinic owner who opens your email is a step closer. Go." },
  { title: 'Good morning 👋', body: "You're building something real. Don't waste the day — check your tasks." },
  { title: "Let's go Alex", body: "The first client is out there. Today might be the day they reply." },
  { title: 'Up and at it 💜', body: "17 and building a SaaS. Most people your age are still in bed. Keep going." },
  { title: 'Morning check-in', body: "Open your tracker. Tick the boxes. That's how it compounds." },
  { title: 'Day one energy 🚀', body: "Treat today like it's the day before everything changes. Because it might be." },
  { title: 'Good morning 🌄', body: "The streak doesn't build itself. Get on the tasks." },
  { title: "ChatAero needs you", body: "Sophie's ready. The clinics are waiting. You just need to reach them." },
  { title: 'No days off 💪', body: "Consistency is what separates founders who make it from ones who don't." },
  { title: 'Morning Alex', body: "54% open rate. They're reading your emails. Keep sending." },
  { title: 'Small steps 📈', body: "One more email today is one more chance at that first client." },
  { title: 'Fresh day 🌞', body: "Yesterday's gone. What you do today is all that matters." },
  { title: "Let's build 🔨", body: "ChatAero is going to be something. But only if you show up every day." },
  { title: 'Good morning', body: "The dental clinics missing night-time leads don't know about Sophie yet. Go tell them." },
  { title: 'Stay locked in', body: "Distractions are everywhere. Your tasks are right here. Do them first." },
  { title: 'Morning grind 💜', body: "Every founder has a day-zero. You're still in it. Make it count." },
  { title: 'Up early, stay sharp', body: "Check your tracker. What's the one thing that moves ChatAero forward today?" },
  { title: "Don't overthink it", body: "Send the emails. Make the connections. Build the streak. Repeat." },
  { title: 'Morning 🌅', body: "Your competition isn't doing this. That's your edge." },
  { title: 'Belief + action', body: "You've got the product. You've got the hustle. Today, use both." },
  { title: "Let's get it", body: "One cold email that lands the right person changes everything." },
  { title: 'Good morning Alex 👊', body: "Building solo is hard. But you're doing it. Don't stop now." },
  { title: 'New morning 🔥', body: "Streak on the line. Tasks waiting. Clock ticking. Let's go." },
  { title: 'Early bird 🐦', body: "Most 17-year-olds aren't building SaaS companies. You are. Own it." },
  { title: 'Show up today', body: "The only way ChatAero gets its first client is if you keep showing up." },
  { title: 'Good morning', body: "LinkedIn connections, Upwork, emails — stack the small wins today." },
  { title: 'Morning check', body: "Open the tracker. What's first? Do that now." },
  { title: "It adds up 📊", body: "88 emails sent. More replies are coming. Keep the volume up." },
  { title: 'Morning motivation', body: "The hardest part is starting. You've already started. Keep going." },
  { title: 'Day is fresh 🌤', body: "Clean slate. Full energy. Make today count for ChatAero." },
  { title: "Don't let up", body: "You're closer than you think to that first yes. Stay consistent." },
  { title: 'Rise up Alex 💜', body: "Sophie's waiting to be deployed. Go find her first home." },
  { title: 'Big things take time', body: "Every email, every connection, every day — it's all building something." },
  { title: 'Go time 🕘', body: "Morning tasks first. Everything else can wait." },
  { title: 'Stay hungry', body: "First client changes everything. That's today's mission." },
  { title: 'Good morning 💪', body: "The streak is alive. Keep it that way." },
  { title: "You've got this", body: "Solo founder, Salisbury, 17. The odds say no. Prove them wrong." },
  { title: 'New day 🌅', body: "Open rates are solid. Now get the replies. More volume." },
  { title: 'Check in time', body: "What's your one big move for ChatAero today? Make it happen." },
  { title: 'Morning Alex', body: "Every no gets you closer to a yes. Keep sending." },
  { title: 'Build the habit', body: "Champions aren't made on good days. They're made on ordinary ones like today." },
  { title: 'Good morning 🔥', body: "The clinics that need Sophie are out there right now. Go find them." },
  { title: 'Lock in 💜', body: "No one's coming to hand you the first client. Go get them." },
  { title: "Stack the days", body: "Another day in the streak means another day closer to something real." },
  { title: 'Morning reminder', body: "Tasks, emails, connections. In that order. Let's go." },
  { title: "You're building", body: "Not many people your age are doing what you're doing. Remember that." },
  { title: 'Today matters', body: "The compounding effect is real. Today's work pays off in ways you can't see yet." },
  { title: 'Rise and shine', body: "ChatAero is live. The product is ready. Now it's all about reach. Go reach." },
];

const eveningMessages = [
  { title: 'Evening check-in 💜', body: "Tasks still pending — don't break the streak before bed." },
  { title: 'Nearly there', body: "Finish the day strong. Tick those tasks off." },
  { title: 'Day not done yet', body: "You've still got time. Complete the tasks and close the day right." },
  { title: "Don't sleep on it", body: "A few tasks standing between you and a completed day. Finish them." },
  { title: 'Evening nudge 🌙', body: "Almost done — just the tasks left. Get them done." },
  { title: 'Wrap it up 💪', body: "End the day with a full streak. Tasks first." },
  { title: 'Day isn\'t over', body: "You still have tasks to complete. Let\'s close the day strong." },
  { title: 'Evening Alex', body: "ChatAero needs your consistency. Finish the tasks." },
  { title: 'Last push 🔥', body: "Nearly at the finish line for today. Complete the tasks." },
  { title: 'Before you stop', body: "Tasks still open. Finish them — future you will thank you." },
  { title: 'Evening reminder', body: "The streak matters. Don\'t let today be a zero." },
  { title: 'Close strong 💜', body: "Tick the last tasks off. You\'ve come too far to skip a day." },
  { title: 'Final tasks', body: "You\'ve got time. Complete them before you wind down." },
  { title: "Don\'t drop the streak", body: "One more session on the tasks and today\'s a win." },
  { title: 'Still pending 📋', body: "A few tasks left — they\'re not going to do themselves." },
  { title: 'Evening check', body: "Quick one — any tasks left? Do them now while you remember." },
  { title: 'Finish the day right', body: "Completed days compound. Don\'t waste today\'s effort." },
  { title: 'One more push', body: "Evening tasks are waiting. Get them done and rest easy." },
  { title: 'Almost a full day 💜', body: "So close. Finish the remaining tasks and lock in the streak." },
  { title: 'Night tasks 🌙', body: "Before you switch off — complete the tasks. Every day counts." },
  { title: 'End of day nudge', body: "Tasks still open. Close them out. You\'ve got this." },
  { title: 'Don\'t stop now', body: "The day\'s not done until the tasks are. Finish strong." },
  { title: 'Evening 💜', body: "Consistency is the game. Today\'s tasks — do them." },
  { title: 'Streak on the line', body: "You\'ve built something here. Don\'t let it slip. Do the tasks." },
  { title: 'Closing time', body: "Tie up the loose ends. Tasks first, then rest." },
  { title: 'Not yet', body: "Before you sit back — tasks. Quick. Do it." },
  { title: 'Evening push 🔥', body: "The founders who win are the ones who do it even in the evenings. Be that." },
  { title: 'Last chance today', body: "Tasks are still pending. Don\'t end the day on zero." },
  { title: 'You\'re nearly there', body: "A couple of tasks left. Get them done and the day\'s yours." },
  { title: 'Evening, Alex', body: "ChatAero\'s first client won\'t come from half-days. Finish the tasks." },
  { title: 'Wrap up time', body: "What\'s left on the list? Go complete it." },
  { title: 'Evening reminder 💜', body: "Streaks are broken in the evening. Don\'t let that be tonight." },
  { title: 'Almost done', body: "You\'re so close to a full day. Don\'t let the tasks slip." },
  { title: 'Night nudge 🌙', body: "Before bed — did you finish the tasks? If not, now\'s the time." },
  { title: 'Get it done', body: "Tasks pending. Evening ticking. You know what to do." },
  { title: 'Don\'t quit at 6', body: "Finish what you started. Tasks are still open." },
  { title: 'Evening check-in', body: "How\'s the day looking? Anything left? Go complete it." },
  { title: 'Make today count', body: "Every completed day is a step toward that first ChatAero client." },
  { title: 'Evening 🔥', body: "Discipline in the evenings is rare. Be the one who has it." },
  { title: 'Tasks pending 📋', body: "Close the day with nothing left undone. Finish the tasks." },
  { title: 'Final stretch', body: "Push through the last tasks. You\'ll feel better for it." },
  { title: 'Lock in 💜', body: "Evening routine. Tasks. Streak. Done. Let\'s go." },
  { title: 'Don\'t skip tonight', body: "Today\'s tasks aren\'t optional. They\'re how you get the first client." },
  { title: 'Evening reminder', body: "The day\'s nearly gone. Make sure the tasks aren\'t left behind." },
  { title: 'Finish line 🏁', body: "Tasks left standing. Sprint to the end. Do them now." },
  { title: 'Night check', body: "Open the tracker. See what\'s left. Get it done." },
  { title: 'Before you rest', body: "Finish the tasks. Sleep better knowing today was a full day." },
  { title: 'End strong 💪', body: "You started today with intention. End it the same way. Tasks." },
  { title: 'Almost midnight', body: "Don\'t let the day end without the tasks done. You\'ve got time." },
  { title: 'Evening, Alex 💜', body: "One consistent evening at a time. That\'s how ChatAero gets its first client." },
];

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── SCHEDULED NOTIFICATIONS (UK time) ────────────────────────────────

// 9:00 AM trigger — fires at random time between 9:00 and 9:59 AM
cron.schedule('0 9 * * *', () => {
  const delayMs = randomInt(0, 59) * 60 * 1000; // 0–59 min delay
  setTimeout(() => {
    const msg = pickRandom(morningMessages);
    sendPush({ title: msg.title, body: msg.body, tag: 'morning' });
  }, delayMs);
}, { timezone: 'Europe/London' });

// 6:00 PM trigger — fires at random time between 6:00 and 6:59 PM
cron.schedule('0 18 * * *', () => {
  const today = getTodayUK();

  if (tasksDoneDate === today) {
    console.log('All tasks done today — skipping evening reminder');
    return;
  }

  const delayMs = randomInt(0, 59) * 60 * 1000; // 0–59 min delay

  // Single evening reminder — random motivational message
  setTimeout(() => {
    const msg = pickRandom(eveningMessages);
    sendPush({ title: msg.title, body: msg.body, tag: 'evening' });
  }, delayMs);

}, { timezone: 'Europe/London' });

// ── ICON — black background, purple CA (ChatAero brand style) ─────────
function iconSvg(size) {
  const r = Math.round(size * 0.18);
  const s = size;
  const cx = s * 0.3;   // C centre x
  const cy = s * 0.5;   // centre y
  const ro = s * 0.26;  // outer radius
  const ri = s * 0.15;  // inner radius
  const gap = 28;       // opening angle (degrees each side from right)
  const strokeW = ro - ri;
  const mid = (ro + ri) / 2;
  const gapRad = (gap * Math.PI) / 180;

  // C arc path — open on the right
  const x1 = cx + mid * Math.cos(gapRad);
  const y1 = cy - mid * Math.sin(gapRad);
  const x2 = cx + mid * Math.cos(-gapRad);
  const y2 = cy - mid * Math.sin(-gapRad);

  const cPath = `M ${x1.toFixed(1)} ${y1.toFixed(1)}
    A ${mid.toFixed(1)} ${mid.toFixed(1)} 0 1 0 ${x2.toFixed(1)} ${y2.toFixed(1)}`;

  // A — positioned so left leg aligns with C's opening
  const ax = s * 0.62;  // A centre x
  const aw = s * 0.28;  // half-width
  const at = s * 0.18;  // top y
  const ab = s * 0.82;  // bottom y
  const barY = s * 0.60;
  const barOff = aw * 0.35;
  const legW = strokeW;

  // Calculate bar intersection with legs
  const t = (barY - ab) / (at - ab);
  const leftBarX = ax - aw + (aw) * t * 2 * 0;
  const leftX = ax - aw * ((barY - ab) / (at - ab));
  const rightX = ax + aw * ((barY - ab) / (at - ab));

  const aPath = `
    M ${(ax - aw).toFixed(1)} ${ab.toFixed(1)}
    L ${ax.toFixed(1)} ${at.toFixed(1)}
    L ${(ax + aw).toFixed(1)} ${ab.toFixed(1)}
    M ${leftX.toFixed(1)} ${barY.toFixed(1)}
    L ${rightX.toFixed(1)} ${barY.toFixed(1)}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <rect width="${s}" height="${s}" rx="${r}" fill="#000000"/>
  <path d="${cPath}" fill="none" stroke="#7c3aed" stroke-width="${strokeW.toFixed(1)}" stroke-linecap="round"/>
  <path d="${aPath}" fill="none" stroke="#7c3aed" stroke-width="${strokeW.toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

app.get('/icon-192.png', (req, res) => {
  res.setHeader('Content-Type', 'image/svg+xml');
  res.send(iconSvg(192));
});

app.get('/icon-512.png', (req, res) => {
  res.setHeader('Content-Type', 'image/svg+xml');
  res.send(iconSvg(512));
});

// ── CATCH-ALL ─────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Daily tracker running on port ${PORT}`);
});
