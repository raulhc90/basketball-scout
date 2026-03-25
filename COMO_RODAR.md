# Como rodar no celular Android

## Pré-requisitos (PC)
- Node.js instalado: https://nodejs.org (versão LTS)
- Conta GitHub: https://github.com (gratuito)
- Conta Vercel: https://vercel.com (gratuito, login com GitHub)

---

## Passo 1 — Instalar dependências
Abra o terminal na pasta do projeto e rode:
```
npm install
```

## Passo 2 — Testar localmente
```
npm start
```
Abre em http://localhost:3000. Funciona no celular conectado na mesma rede Wi-Fi acessando o IP local (ex: http://192.168.1.100:3000).

## Passo 3 — Subir no GitHub
```
git init
git add .
git commit -m "basketball scout pwa"
```
Crie um repositório no GitHub e siga as instruções para fazer o push.

## Passo 4 — Deploy no Vercel
1. Acesse vercel.com e faça login com GitHub
2. Clique em "Add New Project"
3. Selecione o repositório criado
4. Clique em "Deploy" (zero configuração necessária)
5. Em ~60 segundos você recebe uma URL tipo: https://bball-scout.vercel.app

## Passo 5 — Instalar como app no Android
1. Abra o Google Chrome no Android
2. Acesse a URL do Vercel
3. Menu do Chrome (⋮) → "Adicionar à tela inicial"
4. Confirme o nome e toque em "Adicionar"
5. O ícone aparece na tela inicial como um app

## Atualizar o app
Qualquer push para o GitHub atualiza automaticamente a URL.
