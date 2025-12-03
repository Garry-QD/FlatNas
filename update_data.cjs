const fs = require('fs');
const path = require('path');

const dataPath = path.join('d:', 'FlatNas', 'data', 'data.json');
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

let widget = data.widgets.find(w => w.id === 'w11' || w.type === 'iframe');
if (!widget) {
    console.log('Widget not found, adding it');
    widget = {
        id: 'w11',
        type: 'iframe',
        enable: true,
        data: { url: '' },
        colSpan: 2,
        rowSpan: 2,
        isPublic: true
    };
    data.widgets.push(widget);
}

widget.enable = true;
widget.data = { url: 'https://www.douyin.com/?recommend=1' };

fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
console.log('Updated data.json');
