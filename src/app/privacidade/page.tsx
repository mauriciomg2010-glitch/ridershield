import LegalPage, { CONTACTO } from '@/components/Legal/LegalPage'
export const metadata = { title: 'ZIVO — Privacy Policy / Política de Privacidade' }

const en = [
  { t: '1. Who we are', p: [`ZIVO ("we") is a navigation and safety app for delivery riders, operated from Dublin, Ireland. For any privacy question or request, contact us at ${CONTACTO}.`] },
  { t: '2. What we collect', p: [[
    'Account: name, email address and password (the password is handled by Google Firebase Authentication; we never see it).',
    'Location: your GPS position while the app is open, used for navigation, risk-zone warnings and nearby reports. While the app is a web app, location is only used with the app open on screen.',
    'Live location for groups: only if you turn on location sharing in a group; your position is shown to the members of that group until you turn it off or leave.',
    'Reports you create: type, place, time and direction of travel, plus confirmations and denials you give to other reports.',
    'SOS alerts: when you press SOS, your name and position are sent to the members of your groups.',
    'Referral data: your referral code, who you referred and referral credits.',
    'Feedback and support messages you send us.',
    'Data kept only on your phone (not sent to us): search history, frequent destinations, learned usual routes, settings and the optional diagnostic log, which you can export and send us yourself.',
  ]] },
  { t: '3. Why we use it (legal basis)', p: [[
    'To provide the service you signed up for — navigation, safer routes, reports, groups and SOS (contract).',
    'Live location sharing and SOS — only when you choose to use them (consent; you can stop at any time).',
    'Keeping the community safe, preventing abuse, fraud in the referral programme and fixing bugs (legitimate interests).',
  ]] },
  { t: '4. Who processes it for us', p: ['We use trusted providers that process data on our behalf:', [
    'Google Firebase (authentication and database, EU region).',
    'Vercel (hosting of the app and its server functions).',
    'Mapbox (maps, routes and address search — receives map positions and searched places).',
    'HERE Technologies (Eircode lookup — receives the Eircode searched).',
    'A routing server (Valhalla) used to calculate routes that avoid risk zones — receives start and destination points.',
    'Google Maps — when you paste a Google Maps link, our server opens that link to read the destination.',
  ], 'We do not sell your personal data and we do not use it for advertising profiles. Sponsored spaces in the app are shown the same way to every user.'] },
  { t: '5. How long we keep it', p: [[
    'Account data: while your account exists.',
    'Reports: shown on the map for a limited time depending on the type (from 1 hour to 30 days). When you delete your account, your name is removed from them and they stay only as anonymous safety data.',
    'Live location and presence: removed when you stop sharing or close the session.',
    'When you delete your account, your profile, group memberships and shared location are deleted, and your reports are anonymised.',
  ]] },
  { t: '6. Your rights', p: ['Under the GDPR you can ask to access, correct, export or delete your data, and object to or restrict its use. You can delete your account at any time in the app (Menu → Account → Delete account). You can also complain to the Data Protection Commission (dataprotection.ie).'] },
  { t: '7. Security', p: ['Data is sent over encrypted connections and protected by access rules so that each rider can only change their own data.'] },
  { t: '8. Children', p: ['ZIVO is meant for working riders aged 18 or over and is not directed at children.'] },
  { t: '9. Changes', p: ['If this policy changes we will update the date above and, for important changes, tell you in the app.'] },
]

const pt = [
  { t: '1. Quem somos', p: [`O ZIVO ("nós") é uma app de navegação e segurança para riders de entregas, operada a partir de Dublin, Irlanda. Para qualquer questão ou pedido sobre privacidade: ${CONTACTO}.`] },
  { t: '2. Que dados recolhemos', p: [[
    'Conta: nome, email e palavra-passe (a palavra-passe é tratada pelo Google Firebase Authentication; nós nunca a vemos).',
    'Localização: a posição GPS enquanto a app está aberta, para navegação, avisos de zonas de risco e reports próximos. Enquanto a app for web, a localização só é usada com a app aberta no ecrã.',
    'Localização ao vivo nos grupos: só se ligares a partilha num grupo; a tua posição aparece aos membros desse grupo até desligares ou saíres.',
    'Reports que crias: tipo, local, hora e sentido em que ias, e as confirmações ou negações que dás a outros reports.',
    'Alertas SOS: ao carregar em SOS, o teu nome e posição são enviados aos membros dos teus grupos.',
    'Dados de indicação: o teu código, quem indicaste e os créditos.',
    'Mensagens de sugestão e suporte que nos envias.',
    'Dados guardados só no teu telemóvel (não nos são enviados): histórico de pesquisa, destinos frequentes, caminhos habituais aprendidos, definições e o registo de diagnóstico opcional, que só nos chega se o exportares e enviares.',
  ]] },
  { t: '3. Para que usamos (base legal)', p: [[
    'Prestar o serviço que pediste — navegação, rotas mais seguras, reports, grupos e SOS (contrato).',
    'Partilha de localização ao vivo e SOS — só quando escolhes usá-los (consentimento; podes parar a qualquer momento).',
    'Manter a comunidade segura, evitar abusos e fraude nas indicações e corrigir erros (interesse legítimo).',
  ]] },
  { t: '4. Quem trata os dados por nós', p: ['Usamos fornecedores de confiança que tratam dados em nosso nome:', [
    'Google Firebase (autenticação e base de dados, região UE).',
    'Vercel (alojamento da app e das funções de servidor).',
    'Mapbox (mapas, rotas e pesquisa de moradas — recebe posições no mapa e locais pesquisados).',
    'HERE Technologies (pesquisa de Eircode — recebe o Eircode pesquisado).',
    'Um servidor de rotas (Valhalla) para calcular rotas que evitam zonas de risco — recebe o ponto de partida e o destino.',
    'Google Maps — quando colas um link do Google Maps, o nosso servidor abre esse link para ler o destino.',
  ], 'Não vendemos os teus dados pessoais nem os usamos para perfis de publicidade. Os espaços de patrocínio da app aparecem igual para todos.'] },
  { t: '5. Durante quanto tempo', p: [[
    'Dados da conta: enquanto a conta existir.',
    'Reports: aparecem no mapa durante um tempo limitado conforme o tipo (de 1 hora a 30 dias). Ao eliminares a conta, o teu nome é retirado e ficam só como dados de segurança anónimos.',
    'Localização ao vivo e presença: apagadas quando paras de partilhar ou terminas a sessão.',
    'Ao eliminares a conta, apagamos o perfil, a participação em grupos e a localização partilhada, e os teus reports ficam anónimos.',
  ]] },
  { t: '6. Os teus direitos', p: ['Pelo RGPD podes pedir acesso, correção, exportação ou eliminação dos teus dados, e opor-te ou limitar o seu uso. Podes eliminar a conta a qualquer momento na app (Menu → Conta → Eliminar conta). Podes também apresentar queixa à Data Protection Commission (dataprotection.ie).'] },
  { t: '7. Segurança', p: ['Os dados viajam em ligações cifradas e estão protegidos por regras de acesso para que cada rider só altere os seus próprios dados.'] },
  { t: '8. Menores', p: ['O ZIVO destina-se a riders a trabalhar, com 18 anos ou mais, e não é dirigido a crianças.'] },
  { t: '9. Alterações', p: ['Se esta política mudar, atualizamos a data acima e, nas mudanças importantes, avisamos na app.'] },
]

export default function Page() { return <LegalPage titulo="Privacy Policy · Política de Privacidade" en={en} pt={pt} /> }
