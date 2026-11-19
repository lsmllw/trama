# Gera o mapa "Vau do Prisma" 20x20 com simetria rotacional de 180°.
# Bases em cantos opostos: Azul (1,1), Vermelho (18,18). Rio nas fileiras 9 e 10,
# com duas pontes e a Fonte Prismática no centro. Uso: python3 tools/genmap.py
from collections import deque

N = 20
g = [['.'] * N for _ in range(N)]


def put(x, y, c):
    g[y][x] = c
    g[N - 1 - y][N - 1 - x] = c


for x in range(N):
    put(x, 9, '~')
azul = {
    '=': [(3, 9), (16, 9)],
    'P': [(9, 9), (10, 9)],
    'B': [(1, 1)],
    'V': [(4, 4)],
    'L': [(15, 3)],
    'R': [(2, 7)],
    'F': [(6, 1), (7, 1), (6, 2), (1, 5), (2, 5), (11, 5), (12, 5), (12, 6), (17, 6), (18, 6), (7, 7), (8, 7),
          (14, 2), (15, 2), (5, 4), (6, 4), (18, 3), (4, 8), (5, 8), (13, 8)],
    'C': [(3, 3), (9, 2), (10, 2), (14, 7), (15, 7), (5, 6), (16, 5), (1, 7), (9, 5), (19, 8)],
    '#': [(12, 1), (8, 4), (1, 8), (11, 3), (17, 8)],
    'M': [(10, 7), (11, 7), (2, 8), (3, 8), (15, 8), (16, 8), (8, 8), (11, 8)],
}
for c, cells in azul.items():
    for (x, y) in cells:
        put(x, y, c)
rows = [''.join(r) for r in g]

if __name__ == '__main__':
    for r in rows:
        print(r)
    assert all(rows[y] == rows[N - 1 - y][::-1] for y in range(N)), 'simetria'

    def bfs(start, blocked):
        seen = {start}
        q = deque([start])
        while q:
            x, y = q.popleft()
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < N and 0 <= ny < N and (nx, ny) not in seen and rows[ny][nx] not in blocked:
                    seen.add((nx, ny))
                    q.append((nx, ny))
        return seen

    near_red = [(17, 18), (18, 17)]
    print('unidade comum chega na Base Vermelha:', any(p in bfs((3, 1), set('~B')) for p in near_red))
    print('Blindado chega na Base Vermelha:', any(p in bfs((3, 1), set('~BFC#M')) for p in near_red))
    for p in [(3, 1), (1, 3), (3, 2), (4, 2), (2, 4)]:
        print('casa inicial', p, rows[p[1]][p[0]])
