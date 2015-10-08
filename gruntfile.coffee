###
@Author (c) 2015 Artem Tkachenko
@Licensed under the MIT license.
@Project enfence.com
###

module.exports = (grunt) ->
    #
    # npm config
    #
    grunt.initConfig
        requirejs:
            compile:
                options:
                    baseUrl: '.'
                    mainConfigFile: "src/js/config.js"
                    name: 'src/js/app'
                    out: "build/optimized.js"
                    optimize: "none"
    #
    # npm includs
    #
    grunt.loadNpmTasks('grunt-contrib-requirejs');
    #
    # tasks
    #
    grunt.registerTask 'default',["requirejs"]