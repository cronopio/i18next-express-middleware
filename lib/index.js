'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.LanguageDetector = undefined;
exports.handle = handle;
exports.getResourcesHandler = getResourcesHandler;
exports.missingKeyHandler = missingKeyHandler;
exports.addRoute = addRoute;

var _utils = require('./utils');

var utils = _interopRequireWildcard(_utils);

var _LanguageDetector = require('./LanguageDetector');

var _LanguageDetector2 = _interopRequireDefault(_LanguageDetector);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

var LanguageDetector = exports.LanguageDetector = _LanguageDetector2.default;

function handle(i18next) {
  var options = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

  return function i18nextMiddleware(req, res, next) {
    var ignores = options.ignoreRoutes instanceof Array && options.ignoreRoutes || [];
    for (var i = 0; i < ignores.length; i++) {
      if (req.path.indexOf(ignores[i]) > -1) return next();
    }

    var i18n = i18next.cloneInstance({ initImmediate: false });
    i18n.on('languageChanged', function (lng) {
      // Keep language in sync
      req.language = req.locale = req.lng = lng;
      req.languages = i18next.services.languageUtils.toResolveHierarchy(lng);
      if (i18next.services.languageDetector) {
        i18next.services.languageDetector.cacheUserLanguage(req, res, lng);
      }
    });

    var lng = req.lng;
    if (!req.lng && i18next.services.languageDetector) lng = i18next.services.languageDetector.detect(req, res);

    // set locale
    req.language = req.locale = req.lng = lng;
    req.languages = i18next.services.languageUtils.toResolveHierarchy(lng);

    // trigger sync to instance - might trigger async load!
    i18n.changeLanguage(lng || i18next.options.fallbackLng[0]);

    if (req.i18nextLookupName === 'path' && options.removeLngFromUrl) {
      req.url = utils.removeLngFromUrl(req.url, i18next.services.languageDetector.options.lookupFromPathIndex);
    }

    var t = i18n.t.bind(i18n);
    var exists = i18n.exists.bind(i18n);

    // assert for req
    req.i18n = i18n;
    req.t = t;

    // assert for res -> template
    if (res.locals) {
      res.locals.t = function () {
        return function (text, render) {
          return render(t(text));
        };
      };
      res.locals.exists = function () {
        return function (text, render) {
          return render(exists(text));
        };
      };
      res.locals.i18n = i18n;
      res.locals.language = lng;
      res.locals.languageDir = i18next.dir(lng);
    }

    if (i18next.services.languageDetector) i18next.services.languageDetector.cacheUserLanguage(req, res, lng);

    // load resources
    if (!req.lng) return next();
    i18next.loadLanguages(req.lng, function () {
      next();
    });
  };
};

function getResourcesHandler(i18next, options) {
  options = options || {};
  var maxAge = options.maxAge || 60 * 60 * 24 * 30;

  return function (req, res) {
    if (!i18next.services.backendConnector) return res.status(404).send('i18next-express-middleware:: no backend configured');

    var resources = {};

    res.contentType('json');
    if (options.cache !== undefined ? options.cache : process.env.NODE_ENV === 'production') {
      res.header('Cache-Control', 'public, max-age=' + maxAge);
      res.header('Expires', new Date(new Date().getTime() + maxAge * 1000).toUTCString());
    } else {
      res.header('Pragma', 'no-cache');
      res.header('Cache-Control', 'no-cache');
    }

    var languages = req.query[options.lngParam || 'lng'] ? req.query[options.lngParam || 'lng'].split(' ') : [];
    var namespaces = req.query[options.nsParam || 'ns'] ? req.query[options.nsParam || 'ns'].split(' ') : [];

    // extend ns
    namespaces.forEach(function (ns) {
      if (i18next.options.ns && i18next.options.ns.indexOf(ns) < 0) i18next.options.ns.push(ns);
    });

    i18next.services.backendConnector.load(languages, namespaces, function () {
      languages.forEach(function (lng) {
        namespaces.forEach(function (ns) {
          utils.setPath(resources, [lng, ns], i18next.getResourceBundle(lng, ns));
        });
      });

      res.send(resources);
    });
  };
};

function missingKeyHandler(i18next, options) {
  options = options || {};

  return function (req, res) {
    var lng = req.params[options.lngParam || 'lng'];
    var ns = req.params[options.nsParam || 'ns'];

    if (!i18next.services.backendConnector) return res.status(404).send('i18next-express-middleware:: no backend configured');

    for (var m in req.body) {
      i18next.services.backendConnector.saveMissing([lng], ns, m, req.body[m]);
    }
    res.send('ok');
  };
};

function addRoute(i18next, route, lngs, app, verb, fc) {
  if (typeof verb === 'function') {
    fc = verb;
    verb = 'get';
  }

  // Combine `fc` and possible more callbacks to one array
  var callbacks = [fc].concat(Array.prototype.slice.call(arguments, 6));

  for (var i = 0, li = lngs.length; i < li; i++) {
    var parts = String(route).split('/');
    var locRoute = [];
    for (var y = 0, ly = parts.length; y < ly; y++) {
      var part = parts[y];
      // if the route includes the parameter :lng
      // this is replaced with the value of the language
      if (part === ':lng') {
        locRoute.push(lngs[i]);
      } else if (part.indexOf(':') === 0 || part === '') {
        locRoute.push(part);
      } else {
        locRoute.push(i18next.t(part, { lng: lngs[i] }));
      }
    }

    var routes = [locRoute.join('/')];
    app[verb || 'get'].apply(app, routes.concat(callbacks));
  }
};

exports.default = {
  handle: handle,
  getResourcesHandler: getResourcesHandler,
  missingKeyHandler: missingKeyHandler,
  addRoute: addRoute
};