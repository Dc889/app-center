export async function readDirectoryPages<T>(path:string,valid:(row:unknown)=>row is T,signal:AbortSignal):Promise<T[]> {
  const items:T[]=[],seen=new Set<string>()
  let cursor=''
  for(let page=0;page<100;page++) {
    const url=new URL(path,window.location.origin)
    url.searchParams.set('limit','100')
    if(cursor)url.searchParams.set('cursor',cursor)
    const response=await fetch(url,{signal})
    const data=await response.json()
    if(!response.ok)throw Error(data.error?.message ?? '目录读取失败')
    if(!data || !Array.isArray(data.items) || !data.items.every(valid))throw Error('目录返回内容不完整，请重新读取')
    items.push(...data.items)
    if(data.nextCursor===null || data.nextCursor===undefined || data.nextCursor==='')return items
    if(typeof data.nextCursor!=='string' || data.nextCursor.length>200 || seen.has(data.nextCursor))throw Error('目录分页异常，请重新读取')
    cursor=data.nextCursor;seen.add(cursor)
  }
  throw Error('目录超过读取范围，请缩小搜索后重试')
}
