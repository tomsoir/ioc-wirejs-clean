define

    $plugins: [
        { module: 'wire/debug', trace: true }
        'wire/on'
        'wire/dom'
        'wire/dom/render'
    ]

    mainView:
        render:
            template: '<h1>Helllo</h1>'
        insert:
            first: { $ref: 'dom.first!body' }

    navigation:
        wire:
            spec: "/src/js/components/spec"
