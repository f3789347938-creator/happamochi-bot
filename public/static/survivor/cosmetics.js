export const AURAS=[
 {id:'mint',name:'若葉の光',color:'#b4ffdf',cost:0,style:0},
 {id:'sakura',name:'桜吹雪',color:'#ffadd7',cost:1200,style:1},
 {id:'aurora',name:'極光',color:'#91efff',cost:4500,style:2},
 {id:'solar',name:'太陽冠',color:'#ffce79',cost:9000,style:3},
 {id:'void',name:'星雲の輪',color:'#d3abff',cost:16000,style:4},
 {id:'royal',name:'白金の覇気',color:'#fff2bc',cost:28000,style:5}
];
export const auraFor=id=>AURAS.find(a=>a.id===id)||AURAS[0];
