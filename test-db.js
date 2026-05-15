const { query } = require('./api/_lib/db.js');

(async () => {
  try {
    // Busca os últimos execucao_ids
    console.log('\n=== Verificando dados no banco ===\n');
    
    const result = await query(
      'SELECT DISTINCT execucao_id FROM recebimentos ORDER BY criado_em DESC LIMIT 10',
      []
    );
    console.log('Execução IDs recentes:', result.rows.map(r => r.execucao_id));
    
    if (result.rows.length > 0) {
      const exec_id = result.rows[0].execucao_id;
      console.log(`\nVerificando anos para execucao_id: '${exec_id}'`);
      
      const years = await query(
        'SELECT ARRAY_AGG(DISTINCT ano ORDER BY ano) AS anos FROM recebimentos WHERE execucao_id = $1',
        [exec_id]
      );
      console.log('Anos encontrados:', years.rows[0].anos);
      
      const count = await query(
        'SELECT COUNT(*) AS total FROM recebimentos WHERE execucao_id = $1',
        [exec_id]
      );
      console.log('Total de registros:', count.rows[0].total);
    } else {
      console.log('\n❌ Nenhum registro encontrado no banco recebimentos');
    }
    
  } catch (err) {
    console.error('❌ Erro:', err.message);
  }
  process.exit(0);
})();
