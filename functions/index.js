require('dotenv').config()
const functions = require("firebase-functions")
const TwitterApi = require("twitter-api-v2").default
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp();

// データベースのリファレンスを作成
const db = getFirestore();
const docRef = db.collection('twitter-pkce-demo').doc('credentials');

// Twitterクライアントを初期化
const client = new TwitterApi({ 
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET 
})

// 認可URL
exports.authenticate = functions.https.onRequest(async (req, res) => {
    // 認可URLを生成
    const { url, codeVerifier, state } = client.generateOAuth2AuthLink(
        process.env.CALLBACK_URL,
        // ツイート投稿に必要な権限
        { scope: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'] }
    )
    // `state`、`codeVerifier`をデータベースに保存
    await docRef.set({ state, codeVerifier })
    res.redirect(url)
})

// コールバックURL
exports.callback = functions.https.onRequest(async (req, res) => {
    // stateと認可コードをリクエストから取得
    const { state, code } = req.query
    const doc = await docRef.get()
    const { state: storedState, codeVerifier } = doc.data()
    // 認可サーバーが送信したstateと、データベースに保管したstateが一致するかを検証
    if (state !== storedState) {
        res.sendStatus(400).send("Stateが一致しませんでした")
    }
    // アクセストークン、リフレッシュトークンを取得
    try {
            const { accessToken, refreshToken } = await client.loginWithOAuth2({ code, codeVerifier, redirectUri: process.env.CALLBACK_URL })
            await docRef.set({ accessToken, refreshToken })
            res.redirect("post_tweet")
        } catch(error) {
            res.status(403).send('Code Verifierまたはアクセストークンが無効です')
    }
})

// APIリクエストURL
exports.post_tweet = functions.https.onRequest(async (req, res) => {
    const doc = await docRef.get()
    // リフレッシュトークンをデータベースから取得
    const { refreshToken } = doc.data() 

    // アクセストークンと、新しいリフレッシュトークンを取得
    const {
        client: refreshedClient,
        refreshToken: updatedRefreshToken
    } = await client.refreshOAuth2Token(refreshToken)

    // 新しく取得したリフレッシュトークンをデータベースに保管
    await docRef.set({ refreshToken: updatedRefreshToken })
    // 取得したアクセストークンでツイート投稿エンドポイントにリクエストを送信
    const { data: createdTweet } = await refreshedClient.v2.tweet('Twitter APIからこんにちは');
    res.send(createdTweet)
})