requirejs.config 
    aim: 'src'


    'wire/builder/rjs': 'plugins/builder'

    packages: [
        { name: 'wire',     main: 'wire',       location: 'bower_components/wire' }
        { name: 'when',     main: 'when',       location: 'bower_components/when' }
        { name: 'meld',     main: 'meld',       location: 'bower_components/meld' }
        { name: "domReady", main: "domReady",   location: "bower_components/requirejs-domready" }
    ]
