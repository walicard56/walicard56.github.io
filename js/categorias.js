/*
 * Fôlego — categorias de gastos e categorização automática pelo nome.
 * Carregado antes de js/app.js. Usado também pelo importador de extratos.
 */
(function(){
  'use strict';
  const CATS = [
    {id:'moradia',     emoji:'🏠', nome:'Moradia'},
    {id:'contas',      emoji:'💡', nome:'Contas da casa'},
    {id:'mercado',     emoji:'🛒', nome:'Mercado'},
    {id:'alimentacao', emoji:'🍔', nome:'Comer fora'},
    {id:'transporte',  emoji:'🚗', nome:'Transporte'},
    {id:'saude',       emoji:'💊', nome:'Saúde'},
    {id:'educacao',    emoji:'📚', nome:'Educação'},
    {id:'lazer',       emoji:'🎉', nome:'Lazer'},
    {id:'compras',     emoji:'🛍️', nome:'Compras'},
    {id:'assinaturas', emoji:'📺', nome:'Assinaturas'},
    {id:'trabalho',    emoji:'💼', nome:'Trabalho / MEI'},
    {id:'outros',      emoji:'📦', nome:'Outros'}
  ];
  const BY_ID = Object.fromEntries(CATS.map(c => [c.id, c]));

  // Palavras-chave (sem acento, minúsculas) → categoria. A primeira que bater vence.
  const RULES = [
    ['compras',     ['mercado livre','mercadolivre']],
    ['moradia',     ['aluguel','condominio','iptu','moradia','financiamento imob','prestacao casa']],
    ['contas',      ['energia','luz','enel','cemig','copel','light','celpe','coelba','agua','sabesp','sanepar','copasa',' gas ','conta de gas','comgas','internet','vivo','claro',' tim ',' oi ','celular','telefone','net ']],
    ['mercado',     ['mercado','supermerc','atacad','assai','carrefour','pao de acucar','extra ','feira','hortifruti','acougue','padaria','sacolao']],
    ['alimentacao', ['ifood','rappi','restaurante','lanche','lanchonete','pizza','burger','mcdonald','bk ','subway','cafe','bar ','delivery','marmita','almoco','jantar','sorvete']],
    ['transporte',  ['uber',' 99 ','99pop','cabify','combustivel','gasolina','posto','shell','ipiranga','petrobras','estacionamento','pedagio','onibus','metro','bilhete','transporte','ipva','oficina','mecanico']],
    ['saude',       ['farmacia','drogaria','droga','raia','pacheco','pague menos','medico','consulta','exame','dentista','plano de saude','unimed','hapvida','academia','smartfit','psicolog']],
    ['educacao',    ['faculdade','escola','curso','ingles','livro','udemy','alura','mensalidade escolar','material escolar']],
    ['assinaturas', ['netflix','spotify','prime','amazon prime','disney','hbo','max ','globoplay','youtube','deezer','icloud','google one','chatgpt','claude','assinatura']],
    ['lazer',       ['cinema','show','ingresso','viagem','hotel','airbnb','passeio','festa','jogo','steam','playstation','xbox']],
    ['trabalho',    ['das mei','das-mei','das simples','pgmei',' mei ','simples nacional','contador','cnpj','nota fiscal','material de trabalho']],
    ['compras',     ['shopee','magalu','amazon','americanas','shein','aliexpress','renner','riachuelo','c&a','loja','roupa','sapato','presente']]
  ];
  const norm = s => (' ' + String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'') + ' ');

  function guess(nome){
    const n = norm(nome);
    for(const [cat, words] of RULES) if(words.some(w => n.includes(w))) return cat;
    return null;
  }
  const get = id => BY_ID[id] || BY_ID.outros;
  /** Categoria de um item: a escolhida, senão a adivinhada pelo nome, senão "outros". */
  const of = item => get(item && (item.cat || guess(item.nome)));

  window.FolegoCats = {CATS, get, guess, of};
})();
