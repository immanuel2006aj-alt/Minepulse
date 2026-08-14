import os
import json
import requests
from supabase import create_client, Client
from datetime import datetime
import time
import firebase_admin
from firebase_admin import credentials, messaging
from fastapi import FastAPI
import logging

# ============================================================
# ENVIRONMENT VARIABLES (set on Render dashboard)
# ============================================================
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID")
GOOGLE_CREDENTIALS_JSON = os.environ.get("GOOGLE_CREDENTIALS_JSON")  # Full JSON string
DAILY_CAP_INR = 70.0

# ---------- Initialize Firebase ----------
cred = credentials.Certificate(json.loads(GOOGLE_CREDENTIALS_JSON))
firebase_admin.initialize_app(cred)

# ---------- Initialize Supabase ----------
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

# ---------- Telegram Logger ----------
def send_telegram(message):
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        print("Telegram not configured")
        return
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    try:
        requests.post(url, json={'chat_id': TELEGRAM_CHAT_ID, 'text': message, 'parse_mode': 'HTML'}, timeout=10)
    except Exception as e:
        print(f"Telegram error: {e}")

# ---------- Push Notification ----------
def send_push_notification(token, title, body):
    if not token: return
    try:
        message = messaging.Message(
            notification=messaging.Notification(title=title, body=body),
            token=token,
        )
        messaging.send(message)
    except Exception as e:
        print(f"Push error: {e}")

# ---------- Payout Engine ----------
def run_payout():
    try:
        users = supabase.table('users').select('*').gt('daily_revenue', 0).execute().data
    except Exception as e:
        return f"Supabase error: {e}"

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

        # Update user balance
        supabase.table('users').update({
            'pending_balance': user.get('pending_balance', 0) + payout,
            'daily_revenue': 0,
            'total_earned': user.get('total_earned', 0) + payout
        }).eq('id', user['id']).execute()

        # Log payout
        supabase.table('payouts').insert({
            'user_id': user['id'],
            'amount': payout,
            'status': 'processed',
            'processed_at': datetime.utcnow().isoformat()
        }).execute()

        total_payout += payout
        total_profit += profit
        count += 1

        # Send push
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
