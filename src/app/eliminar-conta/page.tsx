import LegalPage, { CONTACTO } from '@/components/Legal/LegalPage'
export const metadata = { title: 'ZIVO — Delete your account / Eliminar a conta' }

// Página pública exigida pela Google Play (link na secção "Segurança dos dados")
const en = [
  { t: 'How to delete your ZIVO account', p: [[
    'Open the ZIVO app and sign in.',
    'Open the Menu (☰) → Account and scroll to the end, to "Excluir conta para sempre" (Delete account forever).',
    'Enter your password, type EXCLUIR to confirm and tap the red button.',
  ]] },
  { t: 'Delete only some data (keep the account)', p: [[
    'Reports: open your report on the map and delete it.',
    'Emergency contacts: Menu (☰) → Account → clear the contacts and save.',
    'Shared location: turn location sharing off in the menu, or leave the group.',
    `Anything else: email ${CONTACTO} saying which data you want deleted; we do it within 30 days.`,
  ]] },
  { t: 'Can\'t open the app?', p: [`Send an email to ${CONTACTO} from the address of your ZIVO account with the subject "Delete my account". We delete it within 30 days and reply to confirm.`] },
  { t: 'What is deleted', p: [[
    'Your profile (name, email, rider ID), emergency contacts and referral code.',
    'Your group memberships and any shared location.',
    'Your sign-in account (Firebase Authentication).',
  ]] },
  { t: 'What is kept', p: [[
    'Safety reports you created stay on the map for their normal duration (1 hour to 30 days) without your name, as anonymous safety data.',
    'Nothing else is kept after deletion. Deletion is permanent and cannot be undone.',
  ]] },
]
const pt = [
  { t: 'Como eliminar a tua conta ZIVO', p: [[
    'Abre a app ZIVO e entra na tua conta.',
    'Abre o Menu (☰) → Conta e desce até ao fim, a "Excluir conta para sempre".',
    'Escreve a tua senha, escreve EXCLUIR para confirmar e toca no botão vermelho.',
  ]] },
  { t: 'Apagar só alguns dados (sem eliminar a conta)', p: [[
    'Reports: abre o teu report no mapa e apaga-o.',
    'Contactos de emergência: Menu (☰) → Conta → limpa os contactos e guarda.',
    'Localização partilhada: desliga a partilha no menu ou sai do grupo.',
    `Outros dados: envia um email para ${CONTACTO} a dizer que dados queres apagar; fazemos no prazo de 30 dias.`,
  ]] },
  { t: 'Não consegues abrir a app?', p: [`Envia um email para ${CONTACTO} a partir do email da tua conta ZIVO com o assunto "Eliminar a minha conta". Eliminamos no prazo de 30 dias e respondemos a confirmar.`] },
  { t: 'O que é apagado', p: [[
    'O teu perfil (nome, email, ID de rider), contactos de emergência e código de indicação.',
    'A participação em grupos e qualquer localização partilhada.',
    'A tua conta de acesso (Firebase Authentication).',
  ]] },
  { t: 'O que fica', p: [[
    'Os reports de segurança que criaste continuam no mapa durante o tempo normal (de 1 hora a 30 dias), sem o teu nome, como dados de segurança anónimos.',
    'Mais nada é guardado. A eliminação é definitiva e não pode ser desfeita.',
  ]] },
]

export default function Page() { return <LegalPage titulo="Delete your account · Eliminar a conta" en={en} pt={pt} /> }
