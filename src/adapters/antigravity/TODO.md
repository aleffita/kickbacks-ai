# Antigravity Adapter — TODO

## Próximos passos

### 1. Analisar o jetskiAgent/main.js
- Identificar onde o "thinking" / spinner é renderizado no bundle de 12MB
- Buscar por palavras como "thinking", "spinner", "processing", "generating",
  "working", caracteres glyph (✢✶✻✽) similares ao Claude Code
- Verificar se há um array de verbos similar ao que o Kickbacks usa

### 2. Adaptar o patch
- Definir os ANCHORS e ARRAY_RE para o bundle do jetskiAgent
- Criar o block.asset.js específico pros seletores DOM do Cascade Panel
- Ajustar o CSS overlay pros estilos do Antigravity

### 3. CSP / loopback
- Verificar se o extension.js do Antigravity precisa de patch de CSP
- O jetskiAgent é um WebviewView dentro da extensão antigravity
- Pode ser que já tenha connect-src habilitado

### 4. Registrar no registry.ts
```typescript
{
  id: "antigravity",
  locate: () => "/Applications/Antigravity IDE.app/Contents/Resources/app/out/jetskiAgent/main.js",
  make: (t) => new AntigravityAdapter(t),
}
```

### 5. Rebuild
```bash
cd ~/.claude/infra/kickbacks
npm install
npm run build
# Resultado: dist/extension.js
```

### Referências
- Claude Code adapter: `src/adapters/claude-code/adapter.ts`
- block.asset.js (injected code): `src/adapters/claude-code/block.asset.js`
- HOST_ROOT_DIRS patch em `src/locate.ts`
