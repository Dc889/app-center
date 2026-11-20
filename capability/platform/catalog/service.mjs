import { check, json, ledger, listen, prefix } from '../../../runtime/http.mjs'

// Read side of the two publication catalogs. Publication is a separate approved write.
export function startCatalog(kind,options) {
  const store=ledger(options.dir,kind)
  return listen((req,res,path)=>{
    const root=prefix+'/'+kind
    check(req.method==='GET',501,'UPSTREAM_UNSUPPORTED')
    if (path===root) return json(res,{items:store.all(),nextCursor:null})
    check(path.startsWith(root+'/'),404,'NOT_FOUND')
    const item=store.get(decodeURIComponent(path.slice(root.length+1)))
    check(item,404,'NOT_FOUND')
    json(res,item)
  },{...options,close:store.close})
}
