import type { Column, TableNode } from './types';

// Fictional Nordic wholesale business. These are specifications, not production SQL.
export function companyExample(): TableNode[] {
  const nodes: TableNode[] = [];
  type Type = Column['type'];
  const ref = (tableId: string, columnId: string) => ({ tableId, columnId });
  const create = (id: string, layer: string, name: string, row: number, upstream: string[], logic: string, transformation: TableNode['transformation'] = {}) => {
    const node: TableNode = { id, database: 'Northstar', schema: layer, name, upstream, logic, transformation, columns: [], x: 40 + ['bronze', 'silver', 'gold'].indexOf(layer) * 450, y: 80 + row * 350 };
    nodes.push(node); return node;
  };
  const raw = (table: TableNode, name: string, type: Type, key = false) => {
    table.columns.push({ id: name, name, type, precision: 18, scale: 2, businessKey: key, mapping: { kind: 'external', sources: [], externalSource: `${table.name.startsWith('crm') ? 'CRM' : 'ERP'}.${table.name}.${name}`, expression: '' } });
  };
  const mapped = (table: TableNode, name: string, type: Type, sources: [string, string][], expression = '', keys: Partial<Pick<Column, 'primaryKey' | 'foreignKey' | 'businessKey'>> = {}) => {
    table.columns.push({ id: name, name, type, precision: 18, scale: 2, ...keys, mapping: { kind: expression ? 'derived' : sources[0]?.[1] === name ? 'source' : 'alias', sources: sources.map(([t,c]) => ref(t,c)), expression } });
  };
  const customers = create('b_customers','bronze','crm_customers',0,[], 'CRM customer snapshot. One row per customer per extraction; duplicates can arrive on retries.', { loading: 'Nightly snapshot landed as append-only Delta data; retain source history.' });
  for (const [n,t] of [['customer_id','STRING'],['company_name','STRING'],['country_code','STRING'],['email','STRING'],['updated_at','TIMESTAMP']] as [string,Type][]) raw(customers,n,t,n==='customer_id');
  const products = create('b_products','bronze','erp_products',1,[], 'ERP product master. Prices and costs are in SEK.', { loading: 'Daily product snapshot. Preserve source values and extraction history.' });
  for (const [n,t] of [['sku','STRING'],['product_name','STRING'],['category','STRING'],['unit_cost','DECIMAL'],['updated_at','TIMESTAMP']] as [string,Type][]) raw(products,n,t,n==='sku');
  const lines = create('b_lines','bronze','erp_order_lines',2,[], 'ERP order-line export includes header attributes. Grain: one source order line per change event. All monetary values are SEK, excluding VAT.', { loading: 'Incremental extract by updated_at, with a two-day overlap.' });
  for (const [n,t] of [['order_id','STRING'],['line_no','INT'],['customer_id','STRING'],['sku','STRING'],['order_date','DATE'],['quantity','INT'],['unit_price','DECIMAL'],['discount_amount','DECIMAL'],['status','STRING'],['updated_at','TIMESTAMP']] as [string,Type][]) raw(lines,n,t,n==='order_id'||n==='line_no');
  const invoices = create('b_invoices','bronze','erp_invoices',3,[], 'ERP invoice ledger export. One row per invoice version; paid_amount is cumulative, in SEK.', { loading: 'Daily incremental extract by updated_at; include payment updates.' });
  for (const [n,t] of [['invoice_id','STRING'],['order_id','STRING'],['customer_id','STRING'],['invoice_date','DATE'],['due_date','DATE'],['invoice_amount','DECIMAL'],['paid_amount','DECIMAL'],['updated_at','TIMESTAMP']] as [string,Type][]) raw(invoices,n,t,n==='invoice_id');

  const customer = create('s_customer','silver','customer',0,['b_customers'], 'Clean current customer master; one row per customer_id.', { filters: 'Reject blank customer_id to quarantine.', deduplication: 'Latest updated_at per customer_id. Break equal timestamps by ingestion sequence.', loading: 'MERGE on customer_id; type 1 updates.' });
  mapped(customer,'customer_id','STRING',[['b_customers','customer_id']], '', { primaryKey:true,businessKey:true });
  mapped(customer,'customer_name','STRING',[['b_customers','company_name']], 'trim(company_name)');
  mapped(customer,'country_code','STRING',[['b_customers','country_code']], 'upper(trim(country_code))');
  mapped(customer,'email','STRING',[['b_customers','email']], 'lower(trim(email))');
  const product = create('s_product','silver','product',1,['b_products'], 'Clean current product catalogue. Grain: one SKU.', { filters:'Reject blank SKU; quarantine negative unit costs.', deduplication:'Latest updated_at per SKU.', loading:'MERGE on SKU; type 1 updates.' });
  mapped(product,'product_code','STRING',[['b_products','sku']], '', { primaryKey:true,businessKey:true });
  mapped(product,'product_name','STRING',[['b_products','product_name']], 'trim(product_name)');
  mapped(product,'category','STRING',[['b_products','category']], "coalesce(nullif(trim(category), ''), 'Unclassified')");
  mapped(product,'unit_cost','DECIMAL',[['b_products','unit_cost']]);
  const sales = create('s_sales','silver','order_line',2,['b_lines'], 'Conformed fulfilled order lines. Grain: order_id + line_no. Discount_amount is the total line discount.', { filters:"Include status = 'fulfilled'; quarantine missing identifiers, quantity <= 0, or discounts outside 0..quantity * unit_price.", deduplication:'Keep latest updated_at per order_id + line_no before filtering status.', loading:'MERGE on order_id + line_no; remove previously loaded lines that are subsequently cancelled.' });
  for (const [n,t] of [['order_id','STRING'],['line_no','INT'],['customer_id','STRING'],['sku','STRING'],['order_date','DATE'],['quantity','INT']] as [string,Type][]) mapped(sales,n,t,[['b_lines',n]],'',{businessKey:n==='order_id'||n==='line_no'});
  mapped(sales,'net_amount','DECIMAL',[['b_lines','quantity'],['b_lines','unit_price'],['b_lines','discount_amount']], 'quantity * unit_price - coalesce(discount_amount, 0)');
  const invoice = create('s_invoice','silver','invoice',3,['b_invoices'], 'Current invoice balance, one row per invoice_id. Outstanding balances can be negative for overpayments.', { deduplication:'Latest updated_at per invoice_id.', filters:'Quarantine missing invoice_id, customer_id or due_date.', loading:'MERGE daily by invoice_id, including updated payment balances.' });
  for (const [n,t] of [['invoice_id','STRING'],['order_id','STRING'],['customer_id','STRING'],['invoice_date','DATE'],['due_date','DATE']] as [string,Type][]) mapped(invoice,n,t,[['b_invoices',n]],'',{primaryKey:n==='invoice_id',businessKey:n==='invoice_id'});
  mapped(invoice,'outstanding_amount','DECIMAL',[['b_invoices','invoice_amount'],['b_invoices','paid_amount']], 'invoice_amount - coalesce(paid_amount, 0)');

  const dc = create('g_customer','gold','dim_customer',0,['s_customer'], 'Customer dimension for commercial and finance reporting. Type 1; one row per CRM customer. Hash key is a stable string, not an integer identity.', { loading:'MERGE by customer_id; update descriptive attributes in place.' });
  mapped(dc,'customer_key','STRING',[['s_customer','customer_id']], "sha2(concat('CRM|', customer_id), 256)",{primaryKey:true});
  mapped(dc,'customer_id','STRING',[['s_customer','customer_id']], '', {businessKey:true});
  mapped(dc,'customer_name','STRING',[['s_customer','customer_name']]);
  mapped(dc,'country_code','STRING',[['s_customer','country_code']]);
  const dp = create('g_product','gold','dim_product',1,['s_product'], 'Product dimension. Type 1; one row per product_code.', {loading:'MERGE by product_code; update current descriptive attributes.'});
  mapped(dp,'product_key','STRING',[['s_product','product_code']], "sha2(concat('ERP|', product_code), 256)",{primaryKey:true});
  mapped(dp,'product_code','STRING',[['s_product','product_code']], '', {businessKey:true});
  mapped(dp,'product_name','STRING',[['s_product','product_name']]);
  mapped(dp,'category','STRING',[['s_product','category']]);
  const fs = create('g_sales','gold','fact_sales',2,['s_sales','g_customer','g_product'], 'Sales fact at fulfilled order-line grain. Reporting: SUM(net_sales) and SUM(quantity). Do not join invoice balances at order-line grain; this would duplicate balances.', { joins:'order_line.customer_id = dim_customer.customer_id; order_line.sku = dim_product.product_code. Many-to-one lookups; quarantine unmatched keys and retry after dimension load.', aggregation:'One row per order_id + line_no. No pre-aggregation.', loading:'MERGE changed order lines after dimensions; propagate source cancellations.' });
  mapped(fs,'sales_line_key','STRING',[['s_sales','order_id'],['s_sales','line_no']], "sha2(concat_ws('|', order_id, cast(line_no as string)), 256)",{primaryKey:true});
  mapped(fs,'customer_key','STRING',[['g_customer','customer_key'],['s_sales','customer_id']], 'Lookup dim_customer.customer_key using order_line.customer_id = dim_customer.customer_id.',{foreignKey:true});
  mapped(fs,'product_key','STRING',[['g_product','product_key'],['s_sales','sku']], 'Lookup dim_product.product_key using order_line.sku = dim_product.product_code.',{foreignKey:true});
  mapped(fs,'sale_date','DATE',[['s_sales','order_date']]);
  mapped(fs,'quantity','INT',[['s_sales','quantity']]);
  mapped(fs,'net_sales','DECIMAL',[['s_sales','net_amount']]);
  const fr = create('g_ar','gold','fact_receivables',3,['s_invoice','g_customer'], 'Current accounts receivable at invoice grain, not a historical snapshot. Reporting: SUM(outstanding_amount), filtered by is_overdue. Never sum balances across daily extracts.', { joins:'invoice.customer_id = dim_customer.customer_id; many-to-one. Quarantine and retry unmatched customers.', aggregation:'One row per invoice_id.', loading:'Refresh current balances daily; recalculate overdue status every day even when the source invoice has not changed.' });
  mapped(fr,'invoice_id','STRING',[['s_invoice','invoice_id']], '', {primaryKey:true,businessKey:true});
  mapped(fr,'customer_key','STRING',[['g_customer','customer_key'],['s_invoice','customer_id']], 'Lookup dim_customer.customer_key using invoice.customer_id = dim_customer.customer_id.',{foreignKey:true});
  mapped(fr,'due_date','DATE',[['s_invoice','due_date']]);
  mapped(fr,'outstanding_amount','DECIMAL',[['s_invoice','outstanding_amount']]);
  mapped(fr,'is_overdue','BOOLEAN',[['s_invoice','due_date'],['s_invoice','outstanding_amount']], 'due_date < current_date() AND outstanding_amount > 0');
  for (const table of [fs,fr]) for (const column of table.columns) {
    if (column.foreignKey) for (const source of column.mapping!.sources) source.role = source.tableId.startsWith('g_') ? 'value' : 'dependency';
  }
  const dependency = (target: TableNode, source: TableNode, field: string, ...rules: NonNullable<TableNode['ruleDependencies']>[number]['rule'][]) => {
    target.ruleDependencies ??= [];
    for (const rule of rules) target.ruleDependencies.push({tableId:source.id,columnId:field,rule});
  };
  dependency(customer,customers,'customer_id','filters','deduplication','loading');
  dependency(customer,customers,'updated_at','deduplication');
  dependency(product,products,'sku','filters','deduplication','loading');
  dependency(product,products,'unit_cost','filters'); dependency(product,products,'updated_at','deduplication');
  dependency(sales,lines,'order_id','deduplication','loading'); dependency(sales,lines,'line_no','deduplication','loading'); dependency(sales,lines,'updated_at','deduplication');
  for(const field of ['status','quantity','unit_price','discount_amount','customer_id','sku']) dependency(sales,lines,field,'filters');
  dependency(invoice,invoices,'invoice_id','deduplication','filters','loading'); dependency(invoice,invoices,'updated_at','deduplication','loading');
  dependency(invoice,invoices,'customer_id','filters'); dependency(invoice,invoices,'due_date','filters');
  dependency(dc,customer,'customer_id','loading'); dependency(dp,product,'product_code','loading');
  dependency(fs,sales,'customer_id','joins'); dependency(fs,dc,'customer_id','joins'); dependency(fs,sales,'sku','joins'); dependency(fs,dp,'product_code','joins');
  dependency(fs,sales,'order_id','aggregation','loading'); dependency(fs,sales,'line_no','aggregation','loading');
  dependency(fr,invoice,'customer_id','joins'); dependency(fr,dc,'customer_id','joins'); dependency(fr,invoice,'invoice_id','aggregation','loading'); dependency(fr,invoice,'due_date','loading');
  fs.x = 1390; fs.y = 560;
  fr.x = 1390; fr.y = 960;
  return nodes;
}

// Upgrade only untouched example definitions; keep users' edits and positions.
export function upgradeCompanyExample(nodes: TableNode[]) {
  const fresh = companyExample();
  for (const table of nodes) {
    const seed = fresh.find(n=>n.id===table.id); if (!seed) continue;
    if (!table.ruleDependencies) table.ruleDependencies = seed.ruleDependencies?.filter(ref=>table.transformation?.[ref.rule]===seed.transformation?.[ref.rule]);
    for (const column of table.columns) {
      const original = seed.columns.find(c=>c.id===column.id); if (!original?.mapping || !column.mapping) continue;
      if (original.mapping.kind==='external' && column.mapping.kind==='derived' && column.mapping.noInputs && column.mapping.expression===`Ingest ${column.name} from the ${table.name} source export without transformation. External source boundary; not generated in the warehouse.`) column.mapping={...original.mapping};
      if (column.mapping.expression===original.mapping.expression) for(const source of column.mapping.sources) {
        if (source.role===undefined) source.role=original.mapping.sources.find(ref=>ref.tableId===source.tableId && ref.columnId===source.columnId)?.role;
      }
    }
  }
}
