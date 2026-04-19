#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SETH OTONOM SİBER OPERASYON MOTORU (LEVIATHAN MODU) - v3.0.0
"""

import os
import sys
import json
import subprocess
import socket
import requests
import re
import stat
from datetime import datetime
from pathlib import Path

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(BASE_DIR)

try:
    from SETH_Locale import get_text
except ImportError:
    def get_text(k, **kwargs): return f"[{k}]"

os.environ["SETH_WEB"] = "1"
os.environ["TERM"] = "dumb"

class SETHWorker:
    def __init__(self):
        self.reports_dir = os.path.join(os.path.dirname(BASE_DIR), "Reports", "SETH_Archives")
        if not os.path.exists(self.reports_dir): os.makedirs(self.reports_dir)
        self.ua = "Mozilla/5.0 (SETH-Bot/1.0)"
        # Leviathan State: Operasyon Haritası Verisi
        self.state = {
            "targets": {},
            "pwned": [],
            "leaks": [],
            "start_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }
            
    def log_json(self, message, level="INFO", data=None):
        log_obj = {"type": "log", "timestamp": datetime.now().strftime("%H:%M:%S"), "level": level, "message": message, "data": data}
        print(json.dumps(log_obj), flush=True)

    def send_result(self, status, data=None, message=None):
        result = {"type": "result", "status": status, "data": data, "message": message}
        print(json.dumps(result), flush=True)

    def _update_state(self, target, info_type, val):
        if target not in self.state["targets"]:
            self.state["targets"][target] = {"ports": [], "tech": [], "subdomains": [], "risks": []}
        if info_type in self.state["targets"][target]:
            if isinstance(val, list): self.state["targets"][target][info_type].extend(val)
            else: self.state["targets"][target][info_type].append(val)
        self.state["targets"][target][info_type] = list(set(self.state["targets"][target][info_type]))

    # --- 1. Siber Harekat (Multi-Target Campaign) ---
    def execute_campaign(self, scope):
        self.log_json(f"Siber Harekat Başlatıldı: {scope}", "CRITICAL")
        # Basit IP aralığı veya wildcard alan adı işleme simülasyonu
        targets = [scope] # Gerçekte nmap -sL veya benzeri ile genişletilir
        return {"status": "campaign_active", "scope": scope, "initial_targets": targets}

    # --- 2. Sızıntı Verisi (Breach-Feeder) ---
    def execute_breach_query(self, domain):
        self.log_json(f"Sızıntı Veritabanı Sorgulanıyor (OSINT): {domain}", "WARNING")
        # Simülasyon: Gerçek kullanıcı/parola üretmez, yalnızca yüksek seviye OSINT özeti döner.
        summary = {
            "domain": domain,
            "breach_hits": 0,
            "sources_checked": ["public_breach_index_sim"],
            "note": "Bu çıktı gerçek kimlik bilgisi içermez. Ayrıntı için yetkili resmi servislerle doğrulama gerekir."
        }
        self.state["leaks"].append(summary)
        return summary

    # --- 3. Operasyon Haritası (Get State) ---
    def get_operation_map(self):
        return self.state

    # --- Mevcut Modüller (Leviathan Entegrasyonuyla) ---
    def execute_nmap(self, target):
        res = subprocess.run(["nmap", "-sV", "-T4", "--top-ports", "50", target], capture_output=True, text=True)
        ports = re.findall(r"(\d+/tcp\s+open\s+\S+)", res.stdout)
        self._update_state(target, "ports", ports)
        return {"output": res.stdout, "found_ports": ports}

    def execute_subdomain(self, target):
        clean_domain = target.replace("https://", "").replace("http://", "").split("/")[0]
        try:
            res = requests.get(f"https://crt.sh/?q=%25.{clean_domain}&output=json", timeout=10)
            subs = [item['name_value'] for item in res.json()]
            self._update_state(clean_domain, "subdomains", subs)
            return subs
        except: return []

    def main_loop(self):
        self.log_json("SETH v3.0.0-beta 'LEVIATHAN' Çekirdeği Aktif.", "SYSTEM")
        while True:
            try:
                line = sys.stdin.readline()
                if not line: break
                cmd_data = json.loads(line.strip())
                action, target = cmd_data.get("action"), cmd_data.get("target")

                if action == "campaign": res = self.execute_campaign(target)
                elif action == "breach_query": res = self.execute_breach_query(target)
                elif action == "get_map": res = self.get_operation_map()
                elif action == "nmap": res = self.execute_nmap(target)
                elif action == "subdomain": res = self.execute_subdomain(target)
                elif action == "exit": break
                else: res = {"status": "error", "message": f"Bilinmeyen eylem: {action}"}
                
                self.send_result("success", data=res)
            except Exception as e: self.log_json(f"Leviathan Error: {str(e)}", "CRITICAL")

if __name__ == "__main__":
    SETHWorker().main_loop()
