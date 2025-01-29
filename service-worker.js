const APP_NAMESPACE = "Map25K";
const CACHE_NAME = "Map25K_2025_001";
const MAP_CACHE_NAME = "Map25K_Cache2025_000";

// 残したいキャッシュのバージョン(キャッシュ識別子)をこの配列に入れる
// 基本的に現行の1つだけでよい。他は削除される。
const CACHE_KEYS = [
    CACHE_NAME,
    MAP_CACHE_NAME
];

const url_query_parameter = "2025"
const FILES_TO_CACHE_ON_INSTALL = [
    
    // ### HTML ###
    "./index.html",
    
    // ### CSS ###
    "./assets/index.css" + "?" + url_query_parameter,

    // ### Images ###

    // ### Javascript ###
    "./assets/index.js" + "?" + url_query_parameter,
]

const FILES_TO_CACHE_ON_FETCH = FILES_TO_CACHE_ON_INSTALL;

//キャッシュされているタイルの数に応じてメインスレッドのjsファイルで処理を行いたいときは、
//下記のイベントリスナーにpostMessageを介してやり取りする
self.addEventListener('message', async (event) => {
    if(event.data.task && event.data.task === 'query_count_of_cached_tiles'){
        const cache = await caches.open(MAP_CACHE_NAME);
        const keys = await cache.keys();
        const client = event.source.postMessage({
            task: 'response_query_count_of_cached_tiles', 
            number_of_cached_tiles: keys.length
        });
    }else{
        console.log(`[SW message listener] Unknown task ${event.data}`);
    }
})

//urlで渡されたリソースを全て取得する関数
const addAllToCache = async (urls) => {
    const cache = await caches.open(CACHE_NAME);

    for(url of urls){
        let responseFromNetwork = null;
        request = new Request(url);
        try{
            responseFromNetwork = await fetch(request);
        }catch(e){
            // nop
        }

        //レスポンスが存在し、200番台のときキャッシュをurlから取得
        if(responseFromNetwork && responseFromNetwork.ok){
            try{
                await cache.put(url, responseFromNetwork);
                console.log(`[SW install] response cached: ${request.url}`);
            }catch(e){
                console.error(`[SW install] failed to cache: ${request.url}, ${e}`);
            }
        }else{
            if(responseFromNetwork){
                // sendMessageToAllClients(`[SW install] nw response error: ${request.url}, status code ${responseFromNetwork.status}`);
            }else{
                console.log(`[SW install] nw response is null`);
            }
        }
    }
}

//service-worker.jsのインストール時(メインスレッドでservice-workerをregister時)に起動されるイベントリスナー
self.addEventListener("install", async (ev)=>{
    // ev: ExtensibleEvent
    // イベントの存続期間を延長します。 これは、インストール中 (installing) のワーカーの
    // install (en-US) イベントハンドラー と、アクティブ (active) ワーカーの 
    // activate (en-US) イベントハンドラー で呼び出すためのものです。
    // https://developer.mozilla.org/ja/docs/Web/API/ExtendableEvent

    // このイベントリスナはサービスワーカーのインストール時（ページ表示時）に実行されます
    console.log("[SW install] service worker install");

    //指定したリソースの取得が完了するまでインストール終了とせず、待機状態になる
    await ev.waitUntil(addAllToCache(FILES_TO_CACHE_ON_INSTALL));
    //リソースの取得が完了した時点で即座にservice-workerの利用を開始する
    await ev.waitUntil(self.skipWaiting());
    
    console.log("[SW install] service worker install finished");
})

//新しいバージョンのServiceWorkerが有効化されたとき
//installイベントが終了し、serviceWorkerがactivate化されるときに実行される
self.addEventListener('activate', event => {
    console.log('[SW activate] activate event');
    event.waitUntil(
      caches.keys().then(keys => {
        return Promise.all(
          keys.filter(key => {
            //使用しているアプリのみを操作対象とする
            return key.startsWith(APP_NAMESPACE) && !CACHE_KEYS.includes(key);
          }).map(key => {
            // 不要なキャッシュを削除
            console.log(`[SW activate] delete cache: ${key}`);
            return caches.delete(key);
          })
        );
      })
    );
    //次回読み込み時ではなく、現在表示されているページでserviceWorkerを即座に実行
    event.waitUntil(self.clients.claim());
});

//キャッシュ戦略の一つである「Network First」戦略
const networkFirst = async (request) => {
    
    const cache = await caches.open(CACHE_NAME);
    
    let responseFromNetwork;
    let networkError;
    try{
        responseFromNetwork = await fetch(request);
    }catch(e){
        networkError = e;
        console.log(`[SW networkFirst] network error : ${request.url}, ${e}`);
    }

    // ネットワークから取得成功
    if(responseFromNetwork && responseFromNetwork.ok){
        // responseはキャッシュと呼び出し元のfetchで消費されるが、
        // streamなのでcacheへ入れる際、cloneしてからcache.put()する
        console.log(`[SW networkFirst]network success ${request.url}`);
        try{
            await cache.put(request, responseFromNetwork.clone());
        }catch(e){
            console.error(`[SW networkFirst] failed to put to cache ${request.url} ${e}`);
        }
        return responseFromNetwork;
    }

    // ネットワークは疎通状態、404レスポンス(NotFound)
    if(responseFromNetwork && responseFromNetwork.status === 404){
        console.log(`[SW networkFirst]404NOTFOUND ${request.url}`);
        // キャッシュは更新しない
        return responseFromNetwork;
    }

    // ネットワーク取得失敗した場合、cacheから取得して返す
    const responseFromCache = await cache.match(request);
    if(responseFromCache){
        console.log(`[SW networkFirst]network failed, cache hit ${request.url}`);
        return responseFromCache.clone();
    }

    // cacheにもなければ、ネットワークからのレスポンスを返す
    console.log(`[SW networkFirst] network and cache failed ${request.url}`)
    return responseFromNetwork;

}

const networkFirst_lru_delete_cache_untilAsync = async (cache_name, max_size) => {
    navigator.locks
}

//シングルトン（一度しか継承できない）デザインのクラスでLRUCacheを取り扱う
class LRUCacheSingleton{
    static _this = null;
    constructor(delete_at_once=500){
        this.cache_name = null;
        this.max_size = null;
        this._cache = null
        this._is_balancing = false;
        this._size = 0;
        this._delete_at_once = delete_at_once;
    }
    async setCacheName(cache_name){
        this.cache_name = cache_name;
        this._cache = await caches.open(cache_name);
        this.updateSize();
    }
    get cacheName(){
        return this.cache_name;
    }
    setMaxSize(max_size){
        this.max_size = max_size;
    }
    get maxSize(){
        return this.max_size;
    }
    // cacheのkeysから取得したsizeにアップデートする
    async updateSize(){
        const keys = await this._cache.keys();
        this._size = keys.length;
    }
    static getInstance(){
        if(!LRUCacheSingleton._this){
            LRUCacheSingleton._this = new LRUCacheSingleton();
        }
        return LRUCacheSingleton._this;
    }
    get isBalancing(){
        return this._is_balancing;
    }

    async put(request, response){
        try{
            await this._cache.put(request, response);
            this._size++;
        }catch(e){
            throw e;
        }
    }

    //キャッシュしているタイルが最大数を超えたときにdelelte_at_once個削除する関数
    async startBalance(){
        navigator.locks.request("MapCacheDeleteLock", async ()=>{
            if(this._is_balancing){
                return;
            }

            const cache = await caches.open(this.cache_name);
            this._is_balancing = true;
            while(true){
                if(this._size <= this.max_size){
                    // console.log(`[SW CacheDeleterLRUSingleton] No cache item to delete`);
                    break;
                }
                console.time('[TIMER] get keys');
                let keys = await cache.keys();
                console.timeEnd('[TIMER] get keys');
                
                console.time('[TIMER] compute keys length');
                this._size = keys.length;
                console.timeEnd('[TIMER] compute keys length');

                console.time('[TIMER]delete keys');
                // 最大数を超えたら最大数よりdelete_at_once個少ない数までキャッシュを消す
                for(let i = 0; i < keys.length - this.max_size + this._delete_at_once; i++){
                    try{
                        await cache.delete(keys[i]);
                        this._size--;
                    }catch(e){
                        console.log(`failed to delete item from cache ${keys[i].url}`);
                    }
                }
                console.timeEnd('[TIMER]delete keys');
            }
            this._is_balancing = false;
        })
    }
}

//ページ読み込み時にリソースをキャッシュする関数(例：index.html等)
const networkFirst_lru = async (request, cache_name, max_size) => {
    const cache = await caches.open(cache_name);
    
    let responseFromNetwork;
    let networkError;

    try{
        responseFromNetwork = await fetch(request);
    }catch(e){
        networkError = e;
        console.log(`[SW networkFirst_lru] network error : ${e.message} ${request.url}`)
    }

    // ネットワークからの取得成功
    if(responseFromNetwork && responseFromNetwork.ok){
        // キャッシュのサイズ(要素数)が制限以上なら
        // 先頭にあるもの(もっとも最初に追加されたもの)を消す

        console.log(`[SW networkFirst_lru]network success ${request.url}`);

        // 非同期で複数リクエストから呼ばれるので、消すときは件数取得と削除をロックを取得して実行する
        // これによりmax_sizeを超えないことが保障される
        // このブロックは非同期実行されるのでネットワークからの取得には速度的デメリットはない(はず)
        // navigator.locks.request('MapCacheDeleteLock', async ()=>{
        //     const keys = await cache.keys();
        //     if(keys.length >= max_size && keys.length > 0){
        //         try{
        //             await cache.delete(keys[0]);
        //             console.log(`[SW networkFirst_lru] cache[0] deleted: ${request.url}`);
        //         }catch(e){
        //             console.log(`[SW networkFirst_lru] failed to delete cache[0]: ${e.message} ${request.url}`);
        //         }
        //     }
        // })

        // 上のコードだと、削除すべきものが大量にあるときに非同期関数が削除される（？）
        // そのため、一つの処理で規定数になるまで削除するように変更。

        let cache_lru = LRUCacheSingleton.getInstance();
        if(!cache_lru.cacheName){await cache_lru.setCacheName(cache_name);}
        if(!cache_lru.maxSize){cache_lru.setMaxSize(max_size);}

        if(!cache_lru.isRunning){
            cache_lru.startBalance();
        }
        // キャッシュへ追加
        try{
            await cache_lru.put(request, responseFromNetwork.clone());
        }catch(e){
            console.log(`[SW networkFirst_lru] failed to put response to cache: ${e.message} ${request.url}`)
        }

        return responseFromNetwork;
    }

    // ネットワークから取得失敗した場合、cacheから取得して返す
    const responseFromCache = await cache.match(request);
    if(responseFromCache){
        console.log(`[SW networkFirst_lru] network failed, cache hit ${request.url}`);
        return responseFromCache;
    }

    // cacheにもなければ、ネットワークからのレスポンスを返す
    console.log(`[SW networkFirst_lru] network and cache failed ${request.url}`);
    return responseFromNetwork;
}

//地図タイルをキャッシュする関数
const cacheFirst_lru = async (request, cache_name, max_size) => {
    const cache = await caches.open(cache_name);

    // キャッシュから取得する
    const responseFromCache = await cache.match(request);
    if(responseFromCache){
        // console.log(`[SW cacheFirst_lru] cache hit ${request.url}`);
        // キャッシュが見つかったのでCacheを更新し、見つかったものをRecentにする
        try{
            cache.put(request, responseFromCache.clone());
        }catch(e){
            console.log(`[SW cacheFirst_lru] failed to put cached response to cache: ${e.message} ${request.url}`)
        }
        
        return responseFromCache;
    }

    // キャッシュに無かった時、ネットワークから取得
    let responseFromNetwork;
    let networkError;

    try{
        responseFromNetwork = await fetch(request);
    }catch(e){
        networkError = e;
        console.log(`[SW cacheFirst_lru] network error : ${e.message} ${request.url}`)
    }

    // ネットワークから取得成功
    if(responseFromNetwork && responseFromNetwork.ok){
        // console.log(`[SW cacheFirst_lru] network success ${request.url}`);
        // 取得したものをキャッシュに追加する
        let cache_lru = LRUCacheSingleton.getInstance();
        if(!cache_lru.cacheName){await cache_lru.setCacheName(cache_name);}
        if(!cache_lru.maxSize){cache_lru.setMaxSize(max_size);}

        // LRUキャッシュのサイズが規定以上なら古いものを消す
        // put()したときに自動で消す仕様にすればよかった...
        if(!cache_lru.isRunning){
            cache_lru.startBalance();
        }

        // キャッシュへ追加
        try{
            // responseはstreamなので、一応cloneしたものを渡す
            await cache_lru.put(request, responseFromNetwork.clone());
        }catch(e){
            console.log(`[SW cacheFirst_lru] failed to put response to cache: ${e.message} ${request.url}`)
        }

    }
    return responseFromNetwork;
}

//Urlが含まれているかどうか確認する関数（arrUrlが確認対象、full_urlが確認対象が全て入っている想定の対象）
const containsUrl = (arrUrl, full_url) => {
    for(let i=0; i<arrUrl.length; i++){
        let theUrlString = arrUrl[i];
        let theUrl = null;
        if(theUrlString.match(/https?:\/\//)){
            theUrl = new URL(theUrlString);
        }else{
            // self.registration.scopeは、scopeのフォルダが返ってくる
            theUrl = new URL(theUrlString, self.registration.scope);
        }

        if(theUrl && theUrl.href === full_url){
            return true;
        }
    }
    return false;
}

//ブラウザからリクエスト時に実行されるイベントリスナー
self.addEventListener('fetch', async (event) => {

    // リクエストURLが定義済みのリストにある場合は、network-firstで読込みを行う
    if(containsUrl(FILES_TO_CACHE_ON_FETCH, event.request.url)){
        event.respondWith(networkFirst(event.request));
        return;
    }

    // 地理院タイルはLRUで規定枚数までキャッシュする
    // キャッシュがある場合、優先してキャッシュを使用する
    if(event.request.url.match(/^https:\/\/cyberjapandata\.gsi\.go\.jp\/xyz\//)){
        event.respondWith(cacheFirst_lru(event.request, MAP_CACHE_NAME, 3000));
        return;
    }

    // それ以外の場合は何もせず、リクエストをfetchしてそのまま返す
    console.log(`[SW fetch] fetch return original response ${event.request.url}`);
    event.respondWith(fetch(event.request));
    return

})