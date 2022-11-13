function main(args) {
  return {
    parameters: [
      {
        key: 'e1',
        value: process.env.e1
      },
      {
        key: 'p3',
        value: args.p3
      },
      {
        key: 'e3',
        value: process.env.e3
      },
      {
        key: 'p2',
        value: args.p2
      },
      {
        key: 'e2',
        value: process.env.e2
      },
      {
        key: 'p1',
        value: args.p1
      }
    ]
  };
}
