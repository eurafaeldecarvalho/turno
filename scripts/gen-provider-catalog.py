"""Gera src/shared/providerCatalog.json a partir do catalogo extraido do OmniRoute (MIT).

Entrada: docs/research/omniroute/providers.json (extraido de github.com/diegosouzapw/OmniRoute v3.8.53).
So entram provedores de LLM por chave de API, gratuitos oficiais ou locais, com URL http(s).
Ficam de fora: assinaturas via OAuth, cookies de navegador, termos "avoid", descontinuados, so-cliente-oficial.
Assinaturas que sao um CLI de agente viram dica (turnoAgent) para a pessoa usar o botao Agent.
Uso: python scripts/gen-provider-catalog.py
"""
import json
import os
import re
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'docs', 'research', 'omniroute', 'providers.json')
OUT = os.path.join(ROOT, 'src', 'shared', 'providerCatalog.json')

data = json.load(open(SRC, encoding='utf8'))


def api_base(url: str) -> str:
    # URL de chat do registro -> base que o tradutor/CLI usa (sem /chat/completions, /messages, /embeddings)
    u = re.sub(r'/(chat/completions|messages|embeddings|completions|responses)/?$', '', url.strip())
    return u.rstrip('/')


providers = []
hints = []
for x in data:
    kind = x.get('kind')
    if kind == 'oauth-cli' and x.get('turnoAgent'):
        hints.append({'id': x['id'], 'name': x['name'], 'agent': x['turnoAgent']})
        continue
    if kind not in ('api-key', 'free', 'local'):
        continue
    if 'llm' not in (x.get('serviceKinds') or []):
        continue
    url = x.get('baseUrl') or ''
    if not re.match(r'^https?://', url):
        continue
    # http em claro so vale para loopback (modelos locais); provedor remoto tem de ser https, para a
    # chave de API nunca sair sem criptografia (trava que vale tambem em futuras regeracoes do catalogo).
    # urlparse resolve o host real: 'http://localhost:x@evil.com' tem hostname evil.com (um regex cairia nisso).
    if url.startswith('http://') and urlparse(url).hostname not in ('localhost', '127.0.0.1', '::1'):
        continue
    if x.get('tos') == 'avoid' or x.get('deprecated') or x.get('riskNotice') in ('deprecated', 'oauth', 'official-client-only'):
        continue
    style = x.get('apiStyle')
    if style == 'unknown':
        style = 'openai'  # o registro marca "OpenAI-compatible base URL" nas notas; desconhecido = OpenAI
    if style not in ('openai', 'anthropic'):
        continue
    if kind == 'free' and 'duck.ai' in url:
        continue  # endpoint web nao oficial
    base = api_base(url)
    # base que nao e de chat OpenAI (imagens, audio, rota propria): o tradutor acrescentaria /chat/completions e falharia
    if re.search(r'/(images|audio|embeddings|generations|chat-with-ai)(/|$)|/chat$', base):
        continue
    # URL com marcador ({account}, host de exemplo) ou incompleta: a conexao nunca funcionaria sem editar
    if '{' in base or re.search(r'adb-0{6,}|/accounts$|example\.com', base) or x['id'] == 'cloudflare-playground':
        continue
    if '${' in base:
        base = re.sub(r'\$\{[A-Z_]+\}', '8080', base)  # porta padrao editavel pelo usuario
    entry = {
        'id': x['id'],
        'name': x['name'],
        'kind': kind,
        'style': style,
        'baseUrl': base,
    }
    # so modelos de chat: embedding, rerank, voz e imagem nao respondem a /chat/completions
    models = [m for m in (x.get('models') or []) if isinstance(m, str) and not re.search(r'embed|rerank|bge-|nomic|whisper|tts|speech|transcri|dall-e|image|moderation|guard', m, re.I)]
    if x['id'] == 'openrouter':
        models = ['openrouter/auto' if m == 'auto' else m for m in models]
    models = models[:12]
    if models:
        entry['models'] = models
    if x.get('modelsUrl'):
        entry['modelsUrl'] = x['modelsUrl']
    if x.get('freeTier'):
        entry['free'] = True
    if x.get('freeNote'):
        entry['freeNote'] = str(x['freeNote'])[:160]
    if x.get('monthlyFreeTokens'):
        entry['monthlyFreeTokens'] = x['monthlyFreeTokens']
    if x.get('docsUrl'):
        entry['docsUrl'] = x['docsUrl']
    if x.get('authNotes'):
        entry['authNotes'] = str(x['authNotes'])[:300]
    if kind != 'local':
        entry['needsKey'] = True
    providers.append(entry)

providers.sort(key=lambda p: (p['kind'] != 'local', not p.get('free'), p['name'].lower()))
out = {
    'source': 'Derived from OmniRoute v3.8.53 (MIT, (c) 2026 diegosouzapw), github.com/diegosouzapw/OmniRoute',
    'providers': providers,
    'agentHints': hints,
}
with open(OUT, 'w', encoding='utf8', newline='\n') as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
    f.write('\n')
print(len(providers), 'providers;', sum(1 for p in providers if p['style'] == 'anthropic'), 'anthropic;', len(hints), 'agent hints')
