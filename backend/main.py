import os
import json
import requests
from supabase import create_client, Client
from datetime import datetime
import time
import firebase_admin
from firebase_admin import credentials, messaging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import logging

# ============================================================
# ENVIRONMENT VARIABLES (set on Render)
# ============================================================
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID")
GOOGLE_CREDENTIALS_JSON = os.environ.get("GOOGLE_CREDENTIALS_JSON")
DAILY_CAP_INR = 70.0

# ---------- Initialize Firebase ----------
cred = credentials.Certificate(json.loads(GOOGLE_CREDENTIALS_JSON))
firebase_admin.initialize_app(cred)

# ---------- Initialize Supabase ----------
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

# ---------- Helper: Get XMR/INR rate ----------
def get_xmr_to_inr():
    try:
        resp = requests.get("https://api.coingecko.com/api/v3/simple/price?ids=monero&vs_currencies=inr", timeout=5)
        return resp.json()["monero"]["inr"]
    except:
        return 12500.0  # fallback

# ---------- Telegram Logger ----------
def send_telegram(message):
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        return
    try:
        requests.post(
            f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
            json={'chat_id': TELEGRAM_CHAT_ID, 'text': message, 'parse_mode': 'HTML'},
            timeout=10
        )
    except Exception:
        pass

# ---------- Push Notification ----------
def send_push_notification(token, title, body):
    if not token: return
    try:
        message = messaging.Message(
            notification=messaging.Notification(title=title, body=body),
            token=token,
        )
        messaging.send(message)
    except Exception:
        pass

# ---------- Payout Engine ----------
def run_payout():
    users = supabase.table('users').select('*').gt('daily_revenue', 0).execute().data
    if not users:
        send_telegram("📭 No users with revenue today.")
        return "No users."

    total_payout = 0.0
    total_profit = 0.0
    count = 0
    for user in users:
        revenue = user.get('daily_revenue', 0)
        payout = min(revenue, DAILY_CAP_INR)
        profit = revenue - payout

        supabase.table('users').update({
            'pending_balance': user.get('pending_balance', 0) + payout,
            'daily_revenue': 0,
            'total_earned': user.get('total_earned', 0) + payout
        }).eq('id', user['id']).execute()

        supabase.table('payouts').insert({
            'user_id': user['id'],
            'amount': payout,
            'status': 'processed',
            'processed_at': datetime.utcnow().isoformat()
        }).execute()

        total_payout += payout
        total_profit += profit
        count += 1

        token_res = supabase.table('fcm_tokens').select('token').eq('user_id', user['id']).execute()
        if token_res.data:
            send_push_notification(token_res.data[0]['token'], "💰 Payout!", f"₹{payout:.2f} credited.")
        time.sleep(0.5)

    msg = f"✅ Payout done!\nUsers: {count}\nPaid: ₹{total_payout:,.2f}\nProfit: ₹{total_profit:,.2f}"
    send_telegram(msg)
    return msg

# ---------- Resources Data ----------
def get_resources():
    return [
        {"id":1,"name":"SupportXMR","description":"Monero pool","url":"https://supportxmr.com","icon":"M5 5h14v14H5z"},
        {"id":2,"name":"MineXMR","description":"Monero pool","url":"https://minexmr.com","icon":"M5 5h14v14H5z"},
        {"id":3,"name":"MyMonero","description":"Wallet","url":"https://mymonero.com","icon":"M5 5h14v14H5z"},
        {"id":4,"name":"Cake Wallet","description":"Mobile wallet","url":"https://cakewallet.com","icon":"M5 5h14v14H5z"},
        {"id":5,"name":"CoinGecko","description":"Price data","url":"https://coingecko.com/coins/monero","icon":"M5 5h14v14H5z"},
        {"id":6,"name":"XMRchain","description":"Explorer","url":"https://xmrchain.net","icon":"M5 5h14v14H5z"},
    ]

# ---------- FastAPI App ----------
app = FastAPI(title="MinePulse Engine")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------- Pydantic model for hashrate ----------
class HashrateReport(BaseModel):
    user_id: str
    hashrate: float

# ---------- Endpoint: receive hashrate ----------
@app.post("/api/hashrate")
async def report_hashrate(report: HashrateReport):
    user_id = report.user_id
    hashrate = report.hashrate

    # Calculate XMR earned per second (approx)
    xmr_rate = get_xmr_to_inr()
    # Network stats: ~0.000000144 XMR per H/s per day -> per second
    xmr_per_second_per_hash = 1.44e-7 / 86400
    xmr_earned = hashrate * xmr_per_second_per_hash * 10  # 10 seconds interval
    inr_earned = xmr_earned * xmr_rate

    # Update daily earnings in Supabase
    today = datetime.utcnow().date().isoformat()
    try:
        # Get existing daily earnings
        existing = supabase.table('daily_earnings').select('*').eq('user_id', user_id).eq('date', today).execute()
        
        if existing.data:
            old_total = existing.data[0]['total_inr']
            new_total = old_total + inr_earned
            cap_reached = existing.data[0].get('cap_reached', False)
            
            # Update total
            supabase.table('daily_earnings').update({'total_inr': new_total}).eq('user_id', user_id).eq('date', today).execute()
            
            # Also update users.daily_revenue
            supabase.table('users').update({'daily_revenue': supabase.table('users').select('daily_revenue').eq('id', user_id).execute().data[0]['daily_revenue'] + inr_earned}).eq('id', user_id).execute()
            
            # Check if cap just reached
            if new_total >= DAILY_CAP_INR and not cap_reached:
                # Send push notification
                token_res = supabase.table('fcm_tokens').select('token').eq('user_id', user_id).execute()
                if token_res.data:
                    send_push_notification(token_res.data[0]['token'], "🎯 Daily Target Reached!", f"You've earned ₹{DAILY_CAP_INR} today!")
                # Mark cap reached
                supabase.table('daily_earnings').update({'cap_reached': True}).eq('user_id', user_id).eq('date', today).execute()
                send_telegram(f"🎯 User {user_id} reached daily cap.")
        else:
            # First report of the day
            supabase.table('daily_earnings').insert({
                'user_id': user_id,
                'date': today,
                'total_inr': inr_earned,
                'cap_reached': False
            }).execute()
            supabase.table('users').update({'daily_revenue': inr_earned}).eq('id', user_id).execute()
            
    except Exception as e:
        print(f"Error updating earnings: {e}")

    return {"status": "ok"}

# ---------- Existing routes ----------
@app.get("/")
def root():
    return {"message": "Chimera Engine is running"}

@app.get("/api/resources")
def resources():
    return get_resources()

@app.get("/cron/payout")
def payout():
    result = run_payout()
    return {"status": "ok", "result": result}
