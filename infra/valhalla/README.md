# Servidor de rotas próprio (Valhalla)

Hoje o app usa o servidor público gratuito da FOSSGIS (`valhalla1.openstreetmap.de`), que pede
**no máximo 1 consulta por segundo** e não garante disponibilidade. O app já respeita esse limite.
Quando tiver um servidor próprio, a troca é só uma variável de ambiente — nenhum código muda.

## 1. Servidor
- Linux (Ubuntu 22.04+), 2 vCPU, 4–8 GB de RAM, 30 GB de disco já bastam para a Irlanda.
- Instale o Docker: `curl -fsSL https://get.docker.com | sh`

## 2. Subir o Valhalla
```bash
git clone https://github.com/mauriciomg2010-glitch/ridershield.git
cd ridershield/infra/valhalla
mkdir -p custom_files
docker compose up -d
docker compose logs -f   # a 1ª vez baixa o mapa e gera as rotas (alguns minutos)
```
Teste: `curl "http://localhost:8002/status"`

## 3. Permitir polígonos maiores (zonas de risco)
Depois da 1ª inicialização, edite `custom_files/valhalla.json` e aumente
`service_limits.max_exclude_polygons_length` (padrão 10000 m de perímetro somado) para, por exemplo,
`200000`. Reinicie: `docker compose restart`. (Conferir o nome do campo na versão instalada.)

## 4. HTTPS (obrigatório para o app)
Coloque um domínio (ex.: `rotas.seudominio.com`) apontando para o servidor e use um proxy com
certificado automático, por exemplo Caddy:
```
rotas.seudominio.com {
  reverse_proxy localhost:8002
}
```

## 5. Ligar no app (Vercel)
Vercel → Projeto → Settings → Environment Variables:
```
NEXT_PUBLIC_VALHALLA_URL=https://rotas.seudominio.com
```
Faça um novo deploy. O limite de 1 consulta/segundo só vale para o servidor público e é desligado
automaticamente com servidor próprio.

## 6. Manter atualizado
O mapa do OpenStreetMap muda todo dia. Uma vez por semana:
```bash
docker compose down && rm -rf custom_files/valhalla_tiles* && docker compose up -d
```
