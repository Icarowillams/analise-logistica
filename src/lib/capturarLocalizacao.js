// Captura de localização GPS para check-in/checkout de motoristas.
// Regra de negócio: PEDE NOVAMENTE e só segue após capturar — não permite
// prosseguir sem coordenada. Cada tentativa pode ser repetida pelo usuário.

export function obterPosicao(options = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Seu dispositivo não suporta geolocalização.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        precisao: pos.coords.accuracy,
        capturado_em: new Date().toISOString()
      }),
      (err) => {
        if (err.code === 1) reject(new Error('Permissão de localização negada. Permita o acesso ao GPS para continuar.'));
        else if (err.code === 2) reject(new Error('Localização indisponível no momento. Tente novamente.'));
        else if (err.code === 3) reject(new Error('Tempo esgotado ao obter a localização. Tente novamente.'));
        else reject(new Error('Não foi possível obter a localização.'));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0, ...options }
    );
  });
}

// Captura insistente: tenta obter a posição e, em caso de falha, repergunta ao
// usuário se quer tentar de novo. Só resolve quando capturar; rejeita se o
// usuário desistir explicitamente.
export async function capturarLocalizacaoObrigatoria(mensagemContexto = 'Capturando sua localização...') {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await obterPosicao();
    } catch (e) {
      const tentarDeNovo = window.confirm(`${e.message}\n\n${mensagemContexto}\n\nClique OK para tentar novamente, ou Cancelar para desistir.`);
      if (!tentarDeNovo) throw new Error('Captura de localização cancelada pelo usuário.');
    }
  }
}