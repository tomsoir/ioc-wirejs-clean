define

    $plugins: [
        { module: 'wire/debug', trace: true }
        'wire/on'
        'wire/dom'
        'wire/dom/render'
    ]

    view:
        render:
            template: '<h1>NAVIGATION</h1>'
        insert:
            at: {$ref: 'dom.first!body'}
