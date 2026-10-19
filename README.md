# O meu Ironman

Aplicação web para preparar o primeiro Ironman. Tudo corre no browser e os dados ficam guardados no próprio dispositivo.

## O que faz
- **Questionário inicial**: prova e objetivo, experiência em cada modalidade, volume atual e sessões mais longas recentes, lesões, material, janelas de treino por dia, dias com piscina e dia preferido para o treino longo (`src/ui/ProfileView.tsx`).
- **Horário real**: importação do calendário da universidade em .ics (aulas semanais, exames e eventos) e compromissos manuais. O ginásio substitui a força do plano e o futebol conta como treino, sem corrida nesse dia nem corrida dura no dia seguinte (`src/domain/ics.ts`, `src/domain/schedule.ts`).
- **Plano periodizado** a partir da data da prova: base, construção, pico, taper e semana da prova, com semanas de descarga a cada 4 e subidas de volume limitadas a ~10% por semana (`src/domain/plan.ts`).
- **Reorganização automática**: quando uma sessão falha ou um dia tem menos tempo, as sessões-chave passam para outro dia da mesma semana e as secundárias saem (`src/domain/adapt.ts`).
- **Testes e zonas**: CSS na natação, FTP na bicicleta, limiar na corrida e FC de limiar (`src/domain/zones.ts`). Cada passo das sessões mostra o alvo em W, ritmo ou bpm.
- **Importação de ficheiros .FIT** (Garmin, Wahoo, Coros, Zwift) e registo manual, com associação automática à sessão planeada e percentagem de cumprimento (`src/domain/fit.ts`, `src/domain/compliance.ts`).
- **Forma, fadiga e frescura** (CTL/ATL/TSB) com projeção até ao dia da prova e alertas de subida de carga, fadiga e volume de corrida (`src/domain/load.ts`).

- **Calendário**: vista de semana e de mês com treinos, aulas, exames, ginásio e futebol juntos; ao tocar num evento abrem os detalhes e as ações (`src/ui/CalendarView.tsx`).

## Desenvolvimento
```
npm install
npm run dev      # servidor local
npx vitest run   # testes da lógica de treino
npm run build    # versão estática em dist/
```
