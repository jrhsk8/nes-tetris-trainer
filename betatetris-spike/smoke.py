import sys, os, re, time
REPO_PY = '/home/dev/bt-spike/betatetris-tablebase/python'
sys.path.insert(0, REPO_PY)
os.chdir(REPO_PY)  # ev_var.py loads ev_var.npz via a relative path
import numpy as np
import torch
import tetris

# ---- converter: our 200-char ('1'=filled,'0'=empty, row-major from top) -> tetris.Board ----
def our_to_board(s):
    assert len(s) == 200, len(s)
    chars = np.frombuffer(s.encode(), dtype=np.uint8)
    filled = (chars == ord('1')).astype(np.uint8).reshape(20, 10)
    inv = (1 - filled).astype(np.uint8)  # their convention: 1=empty, 0=filled
    return tetris.Board(inv), int(filled.sum())

print("=== converter round-trip ===")
# bottom row filled (10 cells), rest empty
s = '0' * 190 + '1' * 10
b, n = our_to_board(s)
print(f"bottom-row: our_filled={n} Board.Count()={b.Count()} Height={b.Height()}")
print(str(b))
# a left-leaning stack: col0 filled rows 15..19 (5 cells)
grid = np.zeros((20, 10), np.uint8)
grid[15:20, 0] = 1
s2 = ''.join('1' if grid[r, c] else '0' for r in range(20) for c in range(10))
b2, n2 = our_to_board(s2)
print(f"col0 x5: our_filled={n2} Board.Count()={b2.Count()} Height={b2.Height()}")
print(str(b2))

print("=== model smoke ===")
from model import Model, obs_to_torch

def load_model(path):
    sd = torch.load(path, weights_only=True, map_location='cpu')
    channels = sd['main_start.0.main.0.weight'].shape[0]
    sb = len([k for k in sd if re.fullmatch(r'main_start.*main\.0\.weight', k)])
    eb = len([k for k in sd if re.fullmatch(r'main_end.*main\.0\.weight', k)])
    print("arch: channels", channels, "start_blocks", sb, "end_blocks", eb)
    m = Model(sb, eb, channels)
    m.load_state_dict(sd)
    m.eval()
    return m

m = load_model('/home/dev/bt-spike/models/model-v1.0.0-perfect.pth')
g = tetris.Tetris()
g.Reset(0, 1, lines=0, adj_delay=18, aggression_level=0)  # empty board, now=T next=J, level18 lines0
t = time.time()
with torch.no_grad():
    pi, v = m(obs_to_torch(g.GetState()))
dt = time.time() - t
a = int(torch.argmax(pi, 1).item())
print("empty-board now=T placement (r,x,y)=", (a // 200, a // 10 % 20, a % 10),
      "value v[1]=", round(float(v[1].item()), 4), "forward_ms", int(dt * 1000))
print("now", g.GetNowPiece(), "next", g.GetNextPiece(), "lines", g.GetLines())
