import LegalPage, { CONTACTO } from '@/components/Legal/LegalPage'
export const metadata = { title: 'ZIVO — Terms of Use / Termos de Uso' }

const en = [
  { t: '1. The service', p: ['ZIVO helps delivery riders navigate, avoid areas reported as risky, share reports and look out for each other in groups. By creating an account you accept these terms and our Privacy Policy.'] },
  { t: '2. Safety first — important', p: [[
    'Always obey traffic law, road signs and the police. Navigation instructions, routes, risk zones and reports are guidance only and can be wrong or out of date.',
    'Do not handle the phone while riding. Set the destination before you start and use voice guidance.',
    'Risk zones and reports come from the community and from our team. They are not official information and do not guarantee that an area is safe or unsafe.',
    'SOS alerts go to the members of your groups. ZIVO is not an emergency service: in an emergency call 112 or 999.',
  ]] },
  { t: '3. Your account', p: ['You must be 18 or over, give true information and keep your password private. One account per person.'] },
  { t: '4. Fair use', p: [[
    'Only post reports that are true and that you saw yourself. Do not post personal data, insults or anything illegal.',
    'Do not misuse SOS, create fake reports or accounts, or abuse the referral programme.',
    'We may remove content and suspend accounts that break these rules.',
  ]] },
  { t: '5. PRO plan and referrals', p: ['Paid features, prices and referral rewards are shown in the app before you subscribe. Referral rewards are paid only for real, paying subscribers and can be cancelled in case of fraud.'] },
  { t: '6. Availability and liability', p: ['We work to keep ZIVO accurate and available, but it is provided "as is" and may have interruptions or errors. To the extent allowed by law, we are not liable for losses caused by relying on routes, zones or reports. Nothing in these terms limits rights you have as a consumer under Irish and EU law.'] },
  { t: '7. Ending', p: ['You can delete your account at any time in the app. We may close accounts that seriously break these terms.'] },
  { t: '8. Law and contact', p: [`These terms are governed by the laws of Ireland. Questions: ${CONTACTO}.`] },
]

const pt = [
  { t: '1. O serviço', p: ['O ZIVO ajuda riders de entregas a navegar, evitar zonas reportadas como perigosas, partilhar reports e protegerem-se uns aos outros em grupos. Ao criares conta aceitas estes termos e a nossa Política de Privacidade.'] },
  { t: '2. Segurança primeiro — importante', p: [[
    'Cumpre sempre o código da estrada, a sinalização e as indicações da polícia. As instruções, rotas, zonas de risco e reports são apenas orientação e podem estar errados ou desatualizados.',
    'Não mexas no telemóvel a conduzir. Define o destino antes de arrancar e usa a voz.',
    'As zonas de risco e os reports vêm da comunidade e da nossa equipa. Não são informação oficial e não garantem que uma zona seja segura ou perigosa.',
    'Os alertas SOS vão para os membros dos teus grupos. O ZIVO não é um serviço de emergência: numa emergência liga 112 ou 999.',
  ]] },
  { t: '3. A tua conta', p: ['Tens de ter 18 anos ou mais, dar informação verdadeira e manter a palavra-passe privada. Uma conta por pessoa.'] },
  { t: '4. Uso justo', p: [[
    'Só publiques reports verdadeiros e que viste. Não publiques dados pessoais, insultos ou nada ilegal.',
    'Não uses o SOS de forma indevida, não cries reports ou contas falsas e não abuses das indicações.',
    'Podemos remover conteúdos e suspender contas que violem estas regras.',
  ]] },
  { t: '5. Plano PRO e indicações', p: ['Funcionalidades pagas, preços e recompensas de indicação aparecem na app antes de subscreveres. As recompensas só são pagas por subscritores reais e pagantes e podem ser anuladas em caso de fraude.'] },
  { t: '6. Disponibilidade e responsabilidade', p: ['Trabalhamos para o ZIVO ser rigoroso e estar disponível, mas é fornecido "tal como está" e pode ter interrupções ou erros. Na medida permitida por lei, não respondemos por perdas causadas por confiar em rotas, zonas ou reports. Nada nestes termos limita os teus direitos de consumidor pela lei irlandesa e europeia.'] },
  { t: '7. Fim', p: ['Podes eliminar a conta a qualquer momento na app. Podemos fechar contas que violem gravemente estes termos.'] },
  { t: '8. Lei e contacto', p: [`Estes termos regem-se pela lei da Irlanda. Questões: ${CONTACTO}.`] },
]

export default function Page() { return <LegalPage titulo="Terms of Use · Termos de Uso" en={en} pt={pt} /> }
