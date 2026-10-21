# Your Life's — Cyberpunk Life RPG

MVP pessoal de missões e progressão, feito com HTML, CSS e JavaScript modular. Os dados ficam no IndexedDB do navegador; não há conta, servidor de dados nem envio de informações pessoais.

## Executar localmente

É necessário Python 3 para servir a aplicação em `localhost` (o service worker não funciona ao abrir `index.html` diretamente pelo sistema de arquivos).

```powershell
python -m http.server 8000 --bind 127.0.0.1
```

Abra `http://localhost:8000`. Para executar os testes automatizados, instale Node.js 18 ou superior e rode:

```powershell
npm test
```

## Testar no celular

Para testar a interface em outro aparelho na mesma rede, inicie o servidor com `python -m http.server 8000 --bind 0.0.0.0` e acesse `http://<IP-do-computador>:8000`. Para instalar o PWA e validar seu funcionamento offline em um celular, publique em um host HTTPS (por exemplo, GitHub Pages); a política dos navegadores bloqueia service workers em endereços HTTP da rede local.

## Funcionalidades implementadas

- HUD responsivo com nível, XP, atributos, grau, missões e atividade recente.
- Dois visuais (botão no topo): "amigável" (padrão, `css/friendly.css`) e HUD cyberpunk. No visual amigável há quatro paletas — Meia Noite (escura), Meio Dia (clara), Azulado e Rosado (`css/palettes.css`) —, salvas em `localStorage` (`cursed-theme` e `cursed-palette`). Só afetam a aparência, nunca os dados.
- Routine Quests com dias, horário, início/fim e ocorrências identificadas separadamente por data. Pular, registrar ausência ou cancelar não concede XP.
- Special Quests pontuais com data, edição/cancelamento enquanto pendentes e conclusão confirmada.
- Epic Quests com prazo opcional, subtarefas sem XP individual, progresso e recompensa final única após completar todas as etapas.
- Programação semanal, consulta por data e filtros por categoria, modelo e estado.
- Categorias personalizadas, disponíveis depois de criadas em uma missão e incluídas nos filtros.
- Dificuldades configuráveis e XP personalizado (1–500); XP e atributos são gravados junto com o histórico em transações IndexedDB.
- Detecção de duplicidade por data, categoria e nome normalizado, além de identificadores únicos para cada ocorrência.
- Bônus semanal opcional por rotina: +10 XP ao concluir todas as ocorrências programadas daquela rotina na semana, com limite global de 25 XP por semana.
- Progressão de nível centralizada em `js/modules/progression.js`: XP para o próximo nível = `ceil(100 × nível^1,5)` (multiplicador e expoente ajustáveis em `PROGRESSION_CONFIG`). O nível é derivado do XP total, então mudar a fórmula não altera o histórico nem reduz XP. Promoção de grau mediante requisitos e avaliação explícita.
- Modelos de recompensa (`js/modules/rewards.js`): Trabalho 12, Espanhol 35, Academia 18, Estudo focado 25–40, Organização 10; faixas de 60–100 XP (Special) e 150–300 XP (Epic) com sugestão por esforço, importância, preparação e raridade. Modelos apenas preenchem o formulário e podem ser editados.
- Persistência local versionada no IndexedDB, com migração do banco anterior sem apagar missões ou recompensas.
- Dados demonstrativos opcionais; a remoção apaga apenas demos ainda pendentes e preserva o histórico concluído.
- Manifest, ícone e service worker com cache do app shell.

## Limites e próximos passos

O app não implementa diário, conquistas, estatísticas, backup/importação ou sincronização. Ocorrências futuras não podem ser concluídas antecipadamente. Uma atividade é considerada duplicada quando o nome e a categoria normalizados coincidem na mesma data. O bônus semanal exige concluir todas as ocorrências não canceladas de uma rotina habilitada; ausências e ocorrências puladas não contam. Os critérios de grau são regras do aplicativo, não regras oficiais do anime.

Os testes automatizados cobrem XP, níveis, agendamento, deduplicação, bônus semanal e progressão de épicos. Os fluxos de IndexedDB e da interface também devem ser validados em navegador, e `npm test` requer Node.js.
