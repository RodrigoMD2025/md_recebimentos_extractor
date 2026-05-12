/**
 * auth.js — Módulo de autenticação Firebase para páginas protegidas
 * ─────────────────────────────────────────────────────────────────
 * PRÉ-REQUISITO: O Firebase SDK (ESM) deve ser carregado ANTES deste
 * script. A forma recomendada é incluir um bloco <script type="module">
 * no <head> da página que inicializa o Firebase e expõe os serviços
 * necessários em window.__firebaseAuth (veja instrução abaixo).
 *
 * COMO USAR EM PÁGINAS PROTEGIDAS:
 *
 *   1. No <head>, adicione o bloco de inicialização Firebase:
 *
 *      <script type="module">
 *        import { initializeApp }
 *            from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
 *        import { getAuth, onAuthStateChanged, signOut }
 *            from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
 *
 *        const app  = initializeApp(window.FIREBASE_CONFIG);
 *        const auth = getAuth(app);
 *
 *        // Expõe o auth para que auth.js (não-module) possa acessar
 *        window.__firebaseAuth = auth;
 *      </script>
 *
 *   2. Depois, inclua este arquivo:
 *      <script src="js/auth.js"></script>
 *
 *   3. Na inicialização do seu app.js / script principal:
 *      Auth.init(function(user, token) {
 *          // Página carregada — usuário autenticado
 *          console.log('Usuário:', user.email);
 *          startApp(user, token);
 *      });
 *
 * API DISPONÍVEL APÓS Auth.init():
 *   Auth.user          — objeto User do Firebase (somente leitura)
 *   Auth.token         — ID token JWT mais recente (somente leitura)
 *   Auth.init(cb)      — inicializa, protege a rota, chama cb(user, token)
 *   Auth.getToken()    — Promise<string> token atualizado
 *   Auth.logout()      — faz signOut e redireciona para login.html
 *   Auth.headers()     — Promise<Headers> com Authorization: Bearer <token>
 */

(function (global) {
    'use strict';

    /* Caminho relativo para a página de login */
    var LOGIN_PAGE = 'login.html';

    /* ── Utilitários internos ────────────────────────────────── */

    /**
     * Redireciona para o login preservando a URL atual como parâmetro
     * de retorno, útil para redirecionar de volta após o login.
     */
    function redirectToLogin() {
        var current = encodeURIComponent(global.location.pathname + global.location.search);
        global.location.replace(LOGIN_PAGE + '?next=' + current);
    }

    /**
     * Aguarda até que window.__firebaseAuth esteja disponível.
     * Tenta por até ~5 segundos (100ms × 50 tentativas).
     * @returns {Promise<object>} instância getAuth do Firebase
     */
    function waitForAuth() {
        return new Promise(function (resolve, reject) {
            var attempts = 0;
            var maxAttempts = 50;

            (function check() {
                if (global.__firebaseAuth) {
                    resolve(global.__firebaseAuth);
                    return;
                }
                attempts++;
                if (attempts >= maxAttempts) {
                    reject(new Error(
                        '[Auth] window.__firebaseAuth não encontrado. ' +
                        'Certifique-se de inicializar o Firebase SDK antes de carregar auth.js.'
                    ));
                    return;
                }
                setTimeout(check, 100);
            })();
        });
    }

    /* ── Objeto público ─────────────────────────────────────── */

    var Auth = {

        /** @type {import('firebase/auth').User|null} */
        user: null,

        /** @type {string|null} Último ID token obtido */
        token: null,

        /**
         * Inicializa o módulo de autenticação.
         * Verifica se o usuário está logado via onAuthStateChanged.
         *   - Se não logado: redireciona para login.html.
         *   - Se logado: preenche Auth.user, Auth.token e executa callback.
         *
         * @param {function(user: object, token: string): void} callback
         *   Função chamada quando o usuário está autenticado.
         *   Recebe o objeto User e o ID token como argumentos.
         */
        init: function (callback) {
            waitForAuth()
                .then(function (authInstance) {
                    /* onAuthStateChanged é a forma recomendada pelo Firebase para
                       verificar autenticação; evita flash de conteúdo protegido. */
                    authInstance.onAuthStateChanged(function (user) {
                        if (!user) {
                            /* Não autenticado → login */
                            redirectToLogin();
                            return;
                        }

                        Auth.user = user;

                        /* Obtém token inicial (Firebase renova automaticamente) */
                        user.getIdToken(false)
                            .then(function (token) {
                                Auth.token = token;

                                /* Atualiza também o sessionStorage para uso em fetch direto */
                                try {
                                    sessionStorage.setItem('firebase_token', token);
                                    sessionStorage.setItem('firebase_uid',   user.uid);
                                    sessionStorage.setItem('firebase_email', user.email || '');
                                } catch (_) { /* storage pode estar indisponível em modo privado */ }

                                if (typeof callback === 'function') {
                                    callback(user, token);
                                }
                            })
                            .catch(function (err) {
                                console.error('[Auth] Falha ao obter ID token:', err);
                                redirectToLogin();
                            });
                    });
                })
                .catch(function (err) {
                    console.error(err.message);
                });
        },

        /**
         * Retorna uma Promise com o ID token atualizado.
         * O Firebase SDK renova o token automaticamente quando necessário
         * (expiração padrão: 1 hora). Passando `false` evita forçar
         * renovação desnecessária — o SDK decide sozinho.
         *
         * @returns {Promise<string>}
         */
        getToken: function () {
            return new Promise(function (resolve, reject) {
                waitForAuth()
                    .then(function (authInstance) {
                        var currentUser = authInstance.currentUser;
                        if (!currentUser) {
                            redirectToLogin();
                            reject(new Error('[Auth] Nenhum usuário autenticado.'));
                            return;
                        }
                        currentUser.getIdToken(false)
                            .then(function (token) {
                                Auth.token = token;
                                try { sessionStorage.setItem('firebase_token', token); } catch (_) {}
                                resolve(token);
                            })
                            .catch(reject);
                    })
                    .catch(reject);
            });
        },

        /**
         * Realiza logout do usuário e redireciona para login.html.
         * Limpa sessionStorage antes do redirecionamento.
         *
         * @returns {Promise<void>}
         */
        logout: function () {
            return waitForAuth()
                .then(function (authInstance) {
                    return authInstance.signOut();
                })
                .then(function () {
                    /* Limpa dados locais */
                    Auth.user  = null;
                    Auth.token = null;
                    try {
                        sessionStorage.removeItem('firebase_token');
                        sessionStorage.removeItem('firebase_uid');
                        sessionStorage.removeItem('firebase_email');
                    } catch (_) {}

                    global.location.replace(LOGIN_PAGE);
                })
                .catch(function (err) {
                    console.error('[Auth] Erro ao fazer logout:', err);
                    /* Redireciona mesmo em caso de erro para garantir segurança */
                    global.location.replace(LOGIN_PAGE);
                });
        },

        /**
         * Retorna um objeto Headers com Authorization: Bearer <token>,
         * pronto para uso em chamadas fetch() para a API.
         *
         * @returns {Promise<{Authorization: string, 'Content-Type': string}>}
         *
         * @example
         * Auth.headers().then(function(headers) {
         *     fetch('/api/data', { headers: headers });
         * });
         */
        headers: function () {
            return Auth.getToken().then(function (token) {
                return {
                    'Authorization': 'Bearer ' + token,
                    'Content-Type':  'application/json',
                    'Accept':        'application/json',
                };
            });
        }
    };

    /* Expõe globalmente */
    global.Auth = Auth;

})(window);
