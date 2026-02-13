// Validação de CPF
export function validarCPF(cpf) {
  cpf = cpf.replace(/\D/g, '');
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false; // todos iguais

  let soma = 0;
  for (let i = 0; i < 9; i++) soma += parseInt(cpf.charAt(i)) * (10 - i);
  let resto = (soma * 10) % 11;
  if (resto === 10) resto = 0;
  if (resto !== parseInt(cpf.charAt(9))) return false;

  soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(cpf.charAt(i)) * (11 - i);
  resto = (soma * 10) % 11;
  if (resto === 10) resto = 0;
  if (resto !== parseInt(cpf.charAt(10))) return false;

  return true;
}

// Validação de CNPJ
export function validarCNPJ(cnpj) {
  cnpj = cnpj.replace(/\D/g, '');
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;

  const pesos1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const pesos2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  let soma = 0;
  for (let i = 0; i < 12; i++) soma += parseInt(cnpj.charAt(i)) * pesos1[i];
  let resto = soma % 11;
  const dig1 = resto < 2 ? 0 : 11 - resto;
  if (parseInt(cnpj.charAt(12)) !== dig1) return false;

  soma = 0;
  for (let i = 0; i < 13; i++) soma += parseInt(cnpj.charAt(i)) * pesos2[i];
  resto = soma % 11;
  const dig2 = resto < 2 ? 0 : 11 - resto;
  if (parseInt(cnpj.charAt(13)) !== dig2) return false;

  return true;
}

// Valida CPF ou CNPJ baseado no tamanho
export function validarDocumento(doc) {
  if (!doc) return { valido: true, erro: '' }; // campo opcional
  const limpo = doc.replace(/\D/g, '');
  if (limpo.length === 0) return { valido: true, erro: '' };
  
  if (limpo.length <= 11) {
    if (limpo.length !== 11) return { valido: false, erro: 'CPF deve ter 11 dígitos' };
    if (!validarCPF(limpo)) return { valido: false, erro: 'CPF inválido' };
    return { valido: true, erro: '' };
  } else {
    if (limpo.length !== 14) return { valido: false, erro: 'CNPJ deve ter 14 dígitos' };
    if (!validarCNPJ(limpo)) return { valido: false, erro: 'CNPJ inválido' };
    return { valido: true, erro: '' };
  }
}

// Formata CPF: 000.000.000-00
export function formatarCPF(cpf) {
  cpf = cpf.replace(/\D/g, '').substring(0, 11);
  if (cpf.length > 9) return cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, '$1.$2.$3-$4');
  if (cpf.length > 6) return cpf.replace(/(\d{3})(\d{3})(\d{1,3})/, '$1.$2.$3');
  if (cpf.length > 3) return cpf.replace(/(\d{3})(\d{1,3})/, '$1.$2');
  return cpf;
}

// Formata CNPJ: 00.000.000/0001-00
export function formatarCNPJ(cnpj) {
  cnpj = cnpj.replace(/\D/g, '').substring(0, 14);
  if (cnpj.length > 12) return cnpj.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{1,2})/, '$1.$2.$3/$4-$5');
  if (cnpj.length > 8) return cnpj.replace(/(\d{2})(\d{3})(\d{3})(\d{1,4})/, '$1.$2.$3/$4');
  if (cnpj.length > 5) return cnpj.replace(/(\d{2})(\d{3})(\d{1,3})/, '$1.$2.$3');
  if (cnpj.length > 2) return cnpj.replace(/(\d{2})(\d{1,3})/, '$1.$2');
  return cnpj;
}

// Formata automaticamente CPF ou CNPJ
export function formatarDocumento(valor) {
  const limpo = valor.replace(/\D/g, '');
  if (limpo.length <= 11) return formatarCPF(limpo);
  return formatarCNPJ(limpo);
}

// Formata CEP: 00000-000
export function formatarCEP(cep) {
  cep = cep.replace(/\D/g, '').substring(0, 8);
  if (cep.length > 5) return cep.replace(/(\d{5})(\d{1,3})/, '$1-$2');
  return cep;
}