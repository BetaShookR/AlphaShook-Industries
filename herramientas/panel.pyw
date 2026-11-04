"""Panel de AlphaShook — ventana para las tareas de mantenimiento (reemplaza a los .bat).

Requiere solo Python 3 (tkinter viene incluido). Abrir con doble clic en "Panel AlphaShook.bat".
"""
import json
import os
import queue
import subprocess
import sys
import threading
import urllib.request
import webbrowser
from pathlib import Path
from tkinter import filedialog, messagebox, ttk
import tkinter as tk

ROOT = Path(__file__).resolve().parent.parent  # carpeta del proyecto
NEON_FILE = ROOT / ".neon-url"
ONLINE_URL = "https://alphashook.onrender.com"
LOCAL_URL = "http://localhost:5173"
WIN = os.name == "nt"
NO_WINDOW = 0x08000000 if WIN else 0  # CREATE_NO_WINDOW

BG, SURF, LINE, TXT, MUTED, ACC, OK, BAD = "#0b0d12", "#181c26", "#2a3041", "#e9ecf3", "#9aa3b8", "#ff6b2c", "#3ccf8e", "#ff5470"
ROLES = {"Moderador": "moderator", "Administrador": "admin", "Desarrollador": "developer", "Usuario normal": "user"}


def read_neon() -> str:
    try:
        return NEON_FILE.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


class Panel(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("Panel AlphaShook")
        self.geometry("880x640")
        self.minsize(760, 560)
        self.configure(bg=BG)
        self.out: queue.Queue = queue.Queue()
        self.busy = False
        self.servers: list[subprocess.Popen] = []
        self._style()
        self._build()
        self.after(100, self._drain)
        self.protocol("WM_DELETE_WINDOW", self._close)
        self.check_online()

    # ───── estilo ─────
    def _style(self) -> None:
        s = ttk.Style(self)
        s.theme_use("clam")
        s.configure(".", background=BG, foreground=TXT, fieldbackground=SURF, bordercolor=LINE, font=("Segoe UI", 10))
        s.configure("TFrame", background=BG)
        s.configure("Card.TFrame", background=SURF)
        s.configure("Card.TLabel", background=SURF, foreground=TXT)
        s.configure("Muted.TLabel", background=SURF, foreground=MUTED, font=("Segoe UI", 9))
        s.configure("Title.TLabel", background=BG, foreground=TXT, font=("Segoe UI", 16, "bold"))
        s.configure("TButton", background=SURF, foreground=TXT, padding=(12, 7), bordercolor=LINE)
        s.map("TButton", background=[("active", "#212634"), ("disabled", BG)], foreground=[("disabled", MUTED)])
        s.configure("Accent.TButton", background=ACC, foreground="#1a0a00", font=("Segoe UI", 10, "bold"))
        s.map("Accent.TButton", background=[("active", "#ff8a3d"), ("disabled", LINE)])
        s.configure("TNotebook", background=BG, borderwidth=0)
        s.configure("TNotebook.Tab", background=SURF, foreground=MUTED, padding=(14, 7))
        s.map("TNotebook.Tab", background=[("selected", "#212634")], foreground=[("selected", TXT)])
        s.configure("TRadiobutton", background=SURF, foreground=TXT)
        s.map("TRadiobutton", background=[("active", SURF)])
        s.configure("TEntry", foreground=TXT, insertcolor=TXT, padding=6)
        s.configure("TCombobox", foreground=TXT, padding=5, arrowcolor=TXT)
        self.option_add("*TCombobox*Listbox.background", SURF)
        self.option_add("*TCombobox*Listbox.foreground", TXT)

    def _card(self, parent, title: str, hint: str = "") -> ttk.Frame:
        f = ttk.Frame(parent, style="Card.TFrame", padding=16)
        f.pack(fill="x", pady=(0, 12))
        ttk.Label(f, text=title, style="Card.TLabel", font=("Segoe UI", 11, "bold")).pack(anchor="w")
        if hint:
            ttk.Label(f, text=hint, style="Muted.TLabel", wraplength=780, justify="left").pack(anchor="w", pady=(2, 10))
        return f

    def _where(self, parent) -> tk.StringVar:
        v = tk.StringVar(value="online")
        row = ttk.Frame(parent, style="Card.TFrame")
        row.pack(anchor="w", pady=(0, 8))
        ttk.Label(row, text="Dónde:", style="Card.TLabel").pack(side="left", padx=(0, 8))
        ttk.Radiobutton(row, text="Tienda online", value="online", variable=v).pack(side="left", padx=(0, 12))
        ttk.Radiobutton(row, text="Mi PC (prueba)", value="local", variable=v).pack(side="left")
        return v

    # ───── interfaz ─────
    def _build(self) -> None:
        head = ttk.Frame(self, padding=(16, 14, 16, 6))
        head.pack(fill="x")
        ttk.Label(head, text="Panel AlphaShook", style="Title.TLabel").pack(side="left")
        self.status = tk.Label(head, text="● comprobando tienda online…", bg=BG, fg=MUTED, font=("Segoe UI", 10))
        self.status.pack(side="right")

        nb = ttk.Notebook(self)
        nb.pack(fill="both", expand=False, padx=16)
        tabs = {name: ttk.Frame(nb, padding=(0, 12, 0, 0)) for name in ("Tienda", "Usuarios", "Juegos", "Publicar", "Ajustes")}
        for name, fr in tabs.items():
            nb.add(fr, text=name)

        # Tienda
        c = self._card(tabs["Tienda"], "Tienda online", ONLINE_URL)
        row = ttk.Frame(c, style="Card.TFrame"); row.pack(anchor="w")
        ttk.Button(row, text="Abrir tienda online", style="Accent.TButton", command=lambda: webbrowser.open(ONLINE_URL)).pack(side="left", padx=(0, 8))
        ttk.Button(row, text="Comprobar estado", command=self.check_online).pack(side="left")
        c = self._card(tabs["Tienda"], "Tienda de prueba en mi PC",
                       "Instala, compila, aplica migraciones y abre la tienda local. Tarda 1-2 minutos la primera vez.")
        row = ttk.Frame(c, style="Card.TFrame"); row.pack(anchor="w")
        self.btn_start = ttk.Button(row, text="Iniciar tienda local", style="Accent.TButton", command=self.start_local)
        self.btn_start.pack(side="left", padx=(0, 8))
        self.btn_stop = ttk.Button(row, text="Detener", command=self.stop_local, state="disabled")
        self.btn_stop.pack(side="left", padx=(0, 8))
        ttk.Button(row, text="Abrir en el navegador", command=lambda: webbrowser.open(LOCAL_URL)).pack(side="left")

        # Usuarios
        c = self._card(tabs["Usuarios"], "Cambiar rol de un usuario",
                       "Moderador: oculta reseñas y mensajes, cierra temas. Administrador: todo. Desarrollador: portal de desarrolladores.")
        self.role_where = self._where(c)
        row = ttk.Frame(c, style="Card.TFrame"); row.pack(anchor="w")
        ttk.Label(row, text="Usuario:", style="Card.TLabel").pack(side="left")
        self.role_user = ttk.Entry(row, width=24); self.role_user.pack(side="left", padx=8)
        ttk.Label(row, text="Rol:", style="Card.TLabel").pack(side="left", padx=(8, 0))
        self.role_sel = ttk.Combobox(row, values=list(ROLES), state="readonly", width=16); self.role_sel.current(1)
        self.role_sel.pack(side="left", padx=8)
        ttk.Button(row, text="Aplicar", style="Accent.TButton", command=self.set_role).pack(side="left", padx=8)

        # Juegos
        c = self._card(tabs["Juegos"], "Cargar o actualizar juegos desde un archivo JSON",
                       "Usa el formato de docs/catalog-template.json. Si el juego ya existe (mismo slug), se actualiza.")
        self.games_where = self._where(c)
        row = ttk.Frame(c, style="Card.TFrame"); row.pack(fill="x")
        self.games_file = tk.StringVar(value=str(ROOT / "juegos.json"))
        ttk.Entry(row, textvariable=self.games_file).pack(side="left", fill="x", expand=True)
        ttk.Button(row, text="Elegir…", command=self.pick_games).pack(side="left", padx=8)
        ttk.Button(row, text="Cargar", style="Accent.TButton", command=self.load_games).pack(side="left")

        # Publicar
        c = self._card(tabs["Publicar"], "Subir cambios a GitHub (Render actualiza la tienda online solo)",
                       "Después de subir, la tienda tarda 3-4 minutos en actualizarse.")
        row = ttk.Frame(c, style="Card.TFrame"); row.pack(fill="x")
        ttk.Label(row, text="Descripción:", style="Card.TLabel").pack(side="left")
        self.commit_msg = ttk.Entry(row); self.commit_msg.insert(0, "Actualizacion AlphaShook")
        self.commit_msg.pack(side="left", fill="x", expand=True, padx=8)
        ttk.Button(row, text="Ver cambios", command=lambda: self.run([["git", "status", "--short"]])).pack(side="left", padx=(0, 8))
        ttk.Button(row, text="Subir", style="Accent.TButton", command=self.publish).pack(side="left")

        # Ajustes
        c = self._card(tabs["Ajustes"], "Base de datos online (Neon)",
                       "La URL se guarda solo en esta PC (archivo .neon-url, no se sube a GitHub).")
        row = ttk.Frame(c, style="Card.TFrame"); row.pack(anchor="w")
        self.neon_lbl = ttk.Label(row, style="Card.TLabel"); self.neon_lbl.pack(side="left", padx=(0, 12))
        ttk.Button(row, text="Cambiar URL", command=self.ask_neon).pack(side="left")
        self._refresh_neon()
        c = self._card(tabs["Ajustes"], "Pruebas automáticas", "Corre los tests de la API contra tu PostgreSQL local.")
        ttk.Button(c, text="Correr tests", command=lambda: self.run([["pnpm", "--filter", "@alphashook/api", "test"]])).pack(anchor="w")

        # Registro
        logf = ttk.Frame(self, padding=(16, 4, 16, 16)); logf.pack(fill="both", expand=True)
        top = ttk.Frame(logf); top.pack(fill="x")
        ttk.Label(top, text="Registro", foreground=MUTED).pack(side="left")
        ttk.Button(top, text="Limpiar", command=lambda: self.log.delete("1.0", "end")).pack(side="right")
        self.log = tk.Text(logf, bg="#05070a", fg=TXT, insertbackground=TXT, relief="flat", font=("Consolas", 10),
                           wrap="word", height=10, padx=10, pady=8, highlightthickness=1, highlightbackground=LINE)
        self.log.pack(fill="both", expand=True, pady=(6, 0))
        self.log.tag_config("ok", foreground=OK); self.log.tag_config("bad", foreground=BAD); self.log.tag_config("info", foreground=ACC)

    # ───── utilidades ─────
    def write(self, text: str, tag: str = "") -> None:
        self.out.put((text, tag))

    def _drain(self) -> None:
        try:
            while True:
                text, tag = self.out.get_nowait()
                self.log.insert("end", text if text.endswith("\n") else text + "\n", tag)
                self.log.see("end")
        except queue.Empty:
            pass
        self.after(100, self._drain)

    def _env(self, where: str = "local") -> dict | None:
        env = {**os.environ, "FORCE_COLOR": "0", "NO_COLOR": "1"}
        env.pop("DATABASE_URL", None)  # nunca usar una variable vieja de la consola
        if where == "online":
            url = read_neon() or self.ask_neon()
            if not url:
                return None
            env["DATABASE_URL"] = url
        return env

    def run(self, cmds: list[list[str]], where: str = "local", done=None) -> None:
        """Ejecuta comandos en orden, en segundo plano, mostrando la salida en el registro."""
        if self.busy:
            messagebox.showinfo("Panel AlphaShook", "Esperá a que termine la tarea actual.")
            return
        env = self._env(where)
        if env is None:
            return
        self.busy = True

        def work() -> None:
            ok = True
            for cmd in cmds:
                self.write("> " + " ".join(cmd), "info")
                try:
                    p = subprocess.Popen(cmd, cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                         shell=WIN, creationflags=NO_WINDOW, text=True, encoding="utf-8", errors="replace")
                    for line in p.stdout:  # type: ignore[union-attr]
                        self.write(line.rstrip("\n"), "ok" if "✓" in line else "bad" if "✗" in line else "")
                    code = p.wait()
                except FileNotFoundError:
                    self.write(f"✗ No se encontró '{cmd[0]}'. ¿Está instalado?", "bad"); code = 1
                if code != 0:
                    ok = False
                    self.write(f"✗ Falló (código {code}). Si no entendés el error, copiá este registro y pasáselo a Claude.", "bad")
                    break
            if ok:
                self.write("✓ Listo.", "ok")
            self.busy = False
            if done:
                self.after(0, lambda: done(ok))

        threading.Thread(target=work, daemon=True).start()

    # ───── acciones ─────
    def check_online(self) -> None:
        def work() -> None:
            try:
                with urllib.request.urlopen(ONLINE_URL + "/health", timeout=60) as r:
                    db = json.load(r).get("db")
                text, color = ("● Tienda online funcionando", OK) if db == "up" else ("● Tienda online sin base de datos", BAD)
            except Exception:
                text, color = ("● Tienda online no responde (puede estar despertando, probá en 1 min)", BAD)
            self.after(0, lambda: self.status.config(text=text, fg=color))
        self.status.config(text="● comprobando tienda online…", fg=MUTED)
        threading.Thread(target=work, daemon=True).start()

    def start_local(self) -> None:
        def after_build(ok: bool) -> None:
            if not ok:
                return
            env = self._env("local")
            for script in ("dev", "dev:web"):
                self.servers.append(subprocess.Popen(["pnpm", script], cwd=ROOT, env=env, shell=WIN, creationflags=NO_WINDOW,
                                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
            self.btn_start.config(state="disabled"); self.btn_stop.config(state="normal")
            self.write("✓ Tienda local iniciándose… se abre el navegador en unos segundos.", "ok")
            self.after(6000, lambda: webbrowser.open(LOCAL_URL))
        self.run([["pnpm", "install"], ["pnpm", "build"], ["pnpm", "db:migrate"]], "local", after_build)

    def stop_local(self) -> None:
        for p in self.servers:
            if WIN:  # pnpm abre procesos hijos: cerrar todo el árbol
                subprocess.run(["taskkill", "/F", "/T", "/PID", str(p.pid)], creationflags=NO_WINDOW, capture_output=True)
            else:
                p.terminate()
        self.servers.clear()
        self.btn_start.config(state="normal"); self.btn_stop.config(state="disabled")
        self.write("Tienda local detenida.", "info")

    def set_role(self) -> None:
        user = self.role_user.get().strip()
        if not user:
            messagebox.showwarning("Panel AlphaShook", "Escribí el nombre de usuario.")
            return
        self.run([["pnpm", "--silent", "user:role", user, ROLES[self.role_sel.get()]]], self.role_where.get())

    def pick_games(self) -> None:
        f = filedialog.askopenfilename(initialdir=ROOT, filetypes=[("JSON", "*.json")])
        if f:
            self.games_file.set(f)

    def load_games(self) -> None:
        f = Path(self.games_file.get())
        if not f.is_file():
            messagebox.showwarning("Panel AlphaShook", "El archivo no existe.")
            return
        self.run([["pnpm", "--silent", "catalog:import", str(f)]], self.games_where.get())

    def publish(self) -> None:
        msg = self.commit_msg.get().strip() or "Actualizacion AlphaShook"
        if not messagebox.askyesno("Panel AlphaShook", "¿Subir los cambios a GitHub y actualizar la tienda online?"):
            return
        commit = ["git", "commit", "-m", msg]
        self.run([["git", "add", "-A"], ["git", "diff", "--cached", "--stat"]], "local",
                 lambda ok: ok and self._commit_push(commit))

    def _commit_push(self, commit: list[str]) -> None:
        staged = subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=ROOT, shell=WIN, creationflags=NO_WINDOW).returncode
        cmds = ([commit] if staged else []) + [["git", "push", "-u", "origin", "main"]]
        if not staged:
            self.write("No había cambios nuevos; se intenta subir lo pendiente.", "info")
        self.run(cmds, "local", lambda ok: ok and self.write("✓ Subido. La tienda online se actualiza en 3-4 minutos.", "ok"))

    def _refresh_neon(self) -> None:
        url = read_neon()
        self.neon_lbl.config(text=("Guardada: " + url.split("@")[-1].split("/")[0]) if url else "Sin configurar")

    def ask_neon(self) -> str:
        win = tk.Toplevel(self, bg=SURF, padx=16, pady=16)
        win.title("URL de Neon"); win.transient(self); win.grab_set()
        tk.Label(win, text="Pegá la URL de Neon (empieza con postgresql://)", bg=SURF, fg=TXT).pack(anchor="w")
        e = ttk.Entry(win, width=70, show="•"); e.pack(pady=10); e.focus_set()
        result = {"url": ""}

        def save() -> None:
            url = e.get().strip()
            if not url.startswith(("postgres://", "postgresql://")):
                messagebox.showwarning("Panel AlphaShook", "Eso no parece una URL de Neon.", parent=win)
                return
            NEON_FILE.write_text(url, encoding="utf-8")
            result["url"] = url
            win.destroy()

        ttk.Button(win, text="Guardar", style="Accent.TButton", command=save).pack(anchor="e")
        win.bind("<Return>", lambda _: save())
        self.wait_window(win)
        self._refresh_neon()
        return result["url"]

    def _close(self) -> None:
        if self.servers and not messagebox.askyesno("Panel AlphaShook", "La tienda local está corriendo. ¿Detenerla y salir?"):
            return
        self.stop_local()
        self.destroy()


if __name__ == "__main__":
    if sys.version_info < (3, 9):
        raise SystemExit("Se necesita Python 3.9 o superior")
    Panel().mainloop()
