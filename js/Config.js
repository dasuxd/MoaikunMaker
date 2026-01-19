class Config{

    static GRID_WIDTH = 32;  // 16列
    static GRID_HEIGHT = 14; // 14行（第一行不放物品）
    static TILE_SIZE = 32;   // 每个格子32x32像素
    static DEBUG_MODE = false;
    static LEVE_TYPE_COUNT = 12; // 关卡类型数量
    static MAX_ENEMIES = 8;

    static ADDRESS_TABLE_START = 0x5841;
    static ADDRESS_TABLE_END = 0x59B0;
    static DATA_START_MAX = 0x7F93;
    static ADDRESS_OFFSET = -0x8000 + 0x10;
    static MONSTER_ADDRESS_OFFSET = 0x33D9;
    static LEVEL_COUNT_ADDRESS = 0x0BD3;
    
    static NES_PALETTE = [
        [0x66, 0x66, 0x66], [0x00, 0x2A, 0x88], [0x14, 0x12, 0xA7], [0x3B, 0x00, 0xA4],
        [0x5C, 0x00, 0x7E], [0x6E, 0x00, 0x40], [0x6C, 0x06, 0x00], [0x56, 0x1D, 0x00],
        [0x33, 0x35, 0x00], [0x0B, 0x48, 0x00], [0x00, 0x52, 0x00], [0x00, 0x4F, 0x08],
        [0x00, 0x40, 0x4D], [0x00, 0x00, 0x00], [0x00, 0x00, 0x00], [0x00, 0x00, 0x00],
        [0xAD, 0xAD, 0xAD], [0x15, 0x5F, 0xD9], [0x42, 0x40, 0xFF], [0x75, 0x27, 0xFE],
        [0xA0, 0x1A, 0xCC], [0xB7, 0x1E, 0x7B], [0xB5, 0x31, 0x20], [0x99, 0x4E, 0x00],
        [0x6B, 0x6D, 0x00], [0x38, 0x87, 0x00], [0x0C, 0x93, 0x00], [0x00, 0x8F, 0x32],
        [0x00, 0x7C, 0x8D], [0x00, 0x00, 0x00], [0x00, 0x00, 0x00], [0x00, 0x00, 0x00],
        [0xFF, 0xFE, 0xFF], [0x64, 0xB0, 0xFF], [0x92, 0x90, 0xFF], [0xC6, 0x76, 0xFF],
        [0xF3, 0x6A, 0xFF], [0xFE, 0x6E, 0xCC], [0xFE, 0x81, 0x70], [0xEA, 0x9E, 0x22],
        [0xBC, 0xBE, 0x00], [0x88, 0xD8, 0x00], [0x5C, 0xE4, 0x30], [0x45, 0xE0, 0x82],
        [0x48, 0xCD, 0xDE], [0x4F, 0x4F, 0x4F], [0x00, 0x00, 0x00], [0x00, 0x00, 0x00],
        [0xFF, 0xFE, 0xFF], [0xC0, 0xDF, 0xFF], [0xD3, 0xD2, 0xFF], [0xE8, 0xC8, 0xFF],
        [0xFB, 0xC2, 0xFF], [0xFE, 0xC4, 0xEA], [0xFE, 0xCC, 0xC5], [0xF7, 0xD8, 0xA5],
        [0xE4, 0xE5, 0x94], [0xCF, 0xEF, 0x96], [0xBD, 0xF4, 0xAB], [0xB3, 0xF3, 0xCC],
        [0xB5, 0xEB, 0xF2], [0xB8, 0xB8, 0xB8], [0x00, 0x00, 0x00], [0x00, 0x00, 0x00]
    ];

    static RESOURCE_IMG_CONFIG = {
        'player':{
            isSprite: true,
            imgBlockIndex:[
                [{index: 0x04, reverse: false}, {index: 0x06, reverse: false}],
                [{index: 0x05, reverse: false}, {index: 0x07, reverse: false}],
            ],
            disabledLevelType:[],
            name: "Player"
        },
        'enemy_1':{
            isSprite: true,
            imgBlockIndex:[
                [{index: 0x94, reverse: false}, {index: 0x96, reverse: false}],
                [{index: 0x95, reverse: false}, {index: 0x97, reverse: false}],
            ],
            disabledLevelType:[],
            name: "Enemy 1"
        },
        'enemy_2':{
            isSprite: true,
            imgBlockIndex:[
                [{index: 0x9C, reverse: false}, {index: 0x9E, reverse: false}],
                [{index: 0x9D, reverse: false}, {index: 0x9F, reverse: false}],
            ],
            disabledLevelType:[],
            name: "Enemy 2"
        },
        'enemy_3':{
            isSprite: true,
            imgBlockIndex:[
                [{index: 0x70, reverse: false}, {index: 0x72, reverse: false}],
                [{index: 0x71, reverse: false}, {index: 0x73, reverse: false}],
                [{index: 0x78, reverse: false}, {index: 0x7A, reverse: false}],
                [{index: 0x79, reverse: false}, {index: 0x7B, reverse: false}],
            ],
            disabledLevelType:[],
            name: "Enemy 3"
        },
        'enemy_4':{
            isSprite: true,
            imgBlockIndex:[
                [{index: 0x60, reverse: false}, {index: 0x60, reverse: true}],
                [{index: 0x61, reverse: false}, {index: 0x61, reverse: true}],
            ],
            disabledLevelType:[],
            name: "Enemy 4"
        },
        'enemy_5':{
            isSprite: true,
            imgBlockIndex:[
                [{index: 0xE0, reverse: false}, {index: 0xE0, reverse: true}],
                [{index: 0xE1, reverse: false}, {index: 0xE1, reverse: true}],
            ],
            disabledLevelType:[],
            name: "Enemy 5"
        },
        'enemy_6':{
            isSprite: true,
            imgBlockIndex:[
                [{index: 0x64, reverse: true},{index: 0x62, reverse: true}],
                [ {index: 0x65, reverse: true},{index: 0x63, reverse: true}],
            ],
            disabledLevelType:[],
            name: "Enemy 6"
        },
        'enemy_7':{
            isSprite: true,
            imgBlockIndex:[
                [{index: 0xAA, reverse: false}, {index: 0xAC, reverse: false}, {index: 0xB2, reverse: false}, {index: 0xB4, reverse: false}],
                [{index: 0xAB, reverse: false}, {index: 0xAD, reverse: false}, {index: 0xB3, reverse: false}, {index: 0xB5, reverse: false}],
                [{index: 0xAE, reverse: false}, {index: 0xB0, reverse: false}, {index: 0xB6, reverse: false}, {index: 0xB8, reverse: false}],
                [{index: 0xAF, reverse: false}, {index: 0xB1, reverse: false}, {index: 0xB7, reverse: false}, {index: 0xB9, reverse: false}],
            ],
            disabledLevelType:[0, 1, 2, 3, 4, 5, 6, 9, 10, 11],
            name: "Enemy 7"
        },
        'enemy_8':{
            isSprite: true,
            imgBlockIndex:[
                [{index: 0x70, reverse: false}, {index: 0x72, reverse: false}],
                [{index: 0x71, reverse: false}, {index: 0x73, reverse: false}],
                [{index: 0x78, reverse: false}, {index: 0x7A, reverse: false}],
                [{index: 0x79, reverse: false}, {index: 0x7B, reverse: false}],
            ],
            disabledLevelType:[],
            name: "Enemy 8"
        },
        // 'enemy_9':{
        //     isSprite: true,
        //     imgBlockIndex:[
        //         [{index: 0x70, reverse: false}, {index: 0x72, reverse: false}],
        //         [{index: 0x71, reverse: false}, {index: 0x73, reverse: false}],
        //         [{index: 0x78, reverse: false}, {index: 0x7A, reverse: false}],
        //         [{index: 0x79, reverse: false}, {index: 0x7B, reverse: false}],
        //     ],
        //     disabledLevelType:[]
        // },
        'enemy_9':{
            isSprite: false,
            imgBlockIndex:[
                [{index: 0xE0, reverse: false}, {index: 0xE1, reverse: false}],
                [{index: 0xE2, reverse: false}, {index: 0xE3, reverse: false}],
                [{index: 0xE4, reverse: false}, {index: 0xE5, reverse: false}],
                [{index: 0xE6, reverse: false}, {index: 0xE7, reverse: false}],
            ],
            disabledLevelType:[0, 1, 2, 3, 4, 5, 6, 9, 10, 11],
            name: "Enemy 9"
        },
        'enemy_10':{
            isSprite: true,
            imgBlockIndex:[
                [{index: 0x80, reverse: false}, {index: 0x82, reverse: false}],
                [{index: 0x81, reverse: false}, {index: 0x83, reverse: false}],
                [{index: 0x88, reverse: false}, {index: 0x8A, reverse: false}],
                [{index: 0x89, reverse: false}, {index: 0x8B, reverse: false}],
            ],
            disabledLevelType:[],
            name: "Enemy 10"
        },
        'enemy_11':{
            isSprite: true,
            imgBlockIndex:[
                [{index: 0xA0, reverse: false}, {index: 0xA2, reverse: false}],
                [{index: 0xA1, reverse: false}, {index: 0xA3, reverse: false}],
            ],
            disabledLevelType:[],
            name: "Enemy 11"
        },
        // crashes when enable these enemies
        // 'enemy_12':{
        //     isSprite: true,
        //     imgBlockIndex:[
        //         [{index: 0xA0, reverse: false}, {index: 0xA2, reverse: false}],
        //         [{index: 0xA1, reverse: false}, {index: 0xA3, reverse: false}],
        //     ],
        //     disabledLevelType:[]
        // },
        // 'enemy_13':{
        //     isSprite: true,
        //     imgBlockIndex:[
        //         [{index: 0xA0, reverse: false}, {index: 0xA2, reverse: false}],
        //         [{index: 0xA1, reverse: false}, {index: 0xA3, reverse: false}],
        //     ],
        //     disabledLevelType:[]
        // },
        // 'enemy_14':{
        //     isSprite: true,
        //     imgBlockIndex:[
        //         [{index: 0xA0, reverse: false}, {index: 0xA2, reverse: false}],
        //         [{index: 0xA1, reverse: false}, {index: 0xA3, reverse: false}],
        //     ],
        //     disabledLevelType:[]
        // },
        // 'enemy_15':{
        //     isSprite: true,
        //     imgBlockIndex:[
        //         [{index: 0xA0, reverse: false}, {index: 0xA2, reverse: false}],
        //         [{index: 0xA1, reverse: false}, {index: 0xA3, reverse: false}],
        //     ],
        //     disabledLevelType:[]
        // },

        'door':{
            isSprite: false,
            imgBlockIndex:[
                [{index: 0x42, reverse: false}, {index: 0x44, reverse: false}, {index: 0x42, reverse: false}, {index: 0x44, reverse: false}],
                [{index: 0x43, reverse: false}, {index: 0x45, reverse: false}, {index: 0x43, reverse: false}, {index: 0x45, reverse: false}],
                [{index: 0x43, reverse: false}, {index: 0x45, reverse: false}, {index: 0x43, reverse: false}, {index: 0x45, reverse: false}],
                [{index: 0x46, reverse: false}, {index: 0x47, reverse: false}, {index: 0x46, reverse: false}, {index: 0x47, reverse: false}],
            ],
            disabledLevelType:[],
            name: "Door"
        },
        'tile_1':{
            isSprite: false,
            imgBlockIndex:[
                [{index: 0x6C, reverse: false}, {index: 0x6E, reverse: false}],
                [{index: 0x6D, reverse: false}, {index: 0x6F, reverse: false}],
            ],
            disabledLevelType:[0, 1],
            name: "Tile 1"
        },
        'tile_2':{
            isSprite: false,
            imgBlockIndex:[
                [{index: 0x70, reverse: false}, {index: 0x72, reverse: false}],
                [{index: 0x71, reverse: false}, {index: 0x73, reverse: false}],
            ],
            disabledLevelType:[0, 1, 11],
            name: "Tile 2"
        },
        'tile_3':{
            isSprite: false,
            imgBlockIndex:[
                [{index: 0x74, reverse: false}, {index: 0x76, reverse: false}],
                [{index: 0x75, reverse: false}, {index: 0x77, reverse: false}],
            ],
            disabledLevelType:[0, 1, 4, 7, 8, 11],
            name: "Tile 3"
        },
        'tile_4':{
            isSprite: false,
            imgBlockIndex:[
                [{index: 0x02, reverse: false}, {index: 0x04, reverse: false}],
                [{index: 0x03, reverse: false}, {index: 0x05, reverse: false}],
            ],
            disabledLevelType:[],
            name: "Tile 4"
        },
        'tile_5':{
            isSprite: false,
            imgBlockIndex:[
                [{index: 0x06, reverse: false}, {index: 0x08, reverse: false}],
                [{index: 0x07, reverse: false}, {index: 0x09, reverse: false}],
            ],
            disabledLevelType:[],
            name: "Tile 5"
        },
        'tile_6':{
            isSprite: false,
            imgBlockIndex:[
                [{index: 0x0A, reverse: false}, {index: 0x0C, reverse: false}],
                [{index: 0x0B, reverse: false}, {index: 0x0D, reverse: false}],
            ],
            disabledLevelType:[],
            name: "Tile 6"
        },
        'tile_7':{
            isSprite: false,
            imgBlockIndex:[
                [{index: 0x0E, reverse: false}, {index: 0x10, reverse: false}],
                [{index: 0x0F, reverse: false}, {index: 0x11, reverse: false}],
            ],
            disabledLevelType:[],
            name: "Tile 7"
        },
        'tile_8':{
            isSprite: false,
            imgBlockIndex:[
                [{index: 0x12, reverse: false}, {index: 0x14, reverse: false}],
                [{index: 0x13, reverse: false}, {index: 0x15, reverse: false}],
            ],
            disabledLevelType:[],
            name: "Tile 8"
        },
        'tile_9':{
            isSprite: false,
            imgBlockIndex:[
                [{index: 0x16, reverse: false}, {index: 0x18, reverse: false}],
                [{index: 0x17, reverse: false}, {index: 0x19, reverse: false}],
            ],
            disabledLevelType:[],
            name: "Tile 9"
        },
        'tile_10':{
            isSprite: false,
            imgBlockIndex:[
                [{index: 0x1A, reverse: false}, {index: 0x1C, reverse: false}],
                [{index: 0x1B, reverse: false}, {index: 0x1D, reverse: false}],
            ],
            disabledLevelType:[],
            name: "Tile 10"
        },
        'tile_11':{
            isSprite: false,
            imgBlockIndex:[
                [{index: 0x1E, reverse: false}, {index: 0x20, reverse: false}],
                [{index: 0x1F, reverse: false}, {index: 0x21, reverse: false}],
            ],
            disabledLevelType:[],
            name: "Tile 11"
        },
        'tile_12':{
            isSprite: false,
            imgBlockIndex:[
                [{index: 0x22, reverse: false}, {index: 0x24, reverse: false}],
                [{index: 0x23, reverse: false}, {index: 0x25, reverse: false}],
            ],
            disabledLevelType:[],
            name: "Tile 12"
        },
        'tile_13':{
            isSprite: false,
            imgBlockIndex:[
                [{index: 0x26, reverse: false}, {index: 0x28, reverse: false}],
                [{index: 0x27, reverse: false}, {index: 0x29, reverse: false}],
            ],
            disabledLevelType:[],
            name: "Tile 13"
        },
        'tile_14':{
            isSprite: false,
            imgBlockIndex:[
                [{index: 0x2A, reverse: false}, {index: 0x2C, reverse: false}],
                [{index: 0x2B, reverse: false}, {index: 0x2D, reverse: false}],
            ],
            disabledLevelType:[],
            name: "Tile 14"
        },
        'tile_15':{
            isSprite: false,
            imgBlockIndex:[
                [{index: 0x2E, reverse: false}, {index: 0x30, reverse: false}],
                [{index: 0x2F, reverse: false}, {index: 0x31, reverse: false}],
            ],
            disabledLevelType:[],
            name: "Tile 15"
        },
    }

    static BG = 'bg';
    static DOOR = 'door';
    static PLAYER = 'player';
    static TILE_PREFIX = 'tile_';
    static ENEMY_PREFIX = 'enemy_';
}